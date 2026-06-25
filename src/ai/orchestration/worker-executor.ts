import type { Message } from '../types.js';
import type { HysaConfig } from '../../config/keys.js';
import { sendVia9Router } from './provider-router.js';
import type { OrchestrationPlan } from './types.js';
import { evaluateAnswerQuality } from '../answer-quality.js';

const PLANNER_SYSTEM_PROMPT = `You are a planning agent. Your job is to analyze the user's request and produce a concise step-by-step plan (3-7 steps) that another agent will execute. Output ONLY numbered steps, no preamble. Each step must be a single concrete action.

Example:
1. Read the main component file to understand current structure
2. Modify the state management to track the new field
3. Update the rendering logic to display the new field
4. Add a handler for the new input`;

const REVIEWER_SYSTEM_PROMPT = `You are a code reviewer. Review the proposed changes for:
1. Missing imports or broken imports
2. Type mismatches or missing TypeScript types
3. Logical errors or edge cases
4. API usage errors (wrong method names, wrong parameters)
5. Path errors in file references
6. Hallucinations (referencing files, functions, or APIs that don't exist)

If you find issues, list each one with the file and line reference. If the code is clean, respond with "REVIEW PASSED" only.`;

export interface PlannerResult {
  plan: string;
  steps: string[];
}

export interface ReviewerResult {
  passed: boolean;
  issues: string[];
  reviewedText: string;
}

export interface WorkerContext {
  config: HysaConfig;
  taskKind: string;
  messages: Message[];
  systemPrompt: string;
  signal?: AbortSignal;
}

export async function executePlannerWorker(context: WorkerContext): Promise<PlannerResult> {
  const planMessages: Message[] = [
    ...context.messages.slice(-2),
    { role: 'user', content: 'Generate a step-by-step plan to fulfill the above request. Output only numbered steps.' },
  ];

  const { response, fallbackEvents } = await sendVia9Router(
    context.config,
    context.taskKind as any,
    planMessages,
    PLANNER_SYSTEM_PROMPT,
    context.signal,
  );

  const planText = response?.message || 'No plan generated';
  const steps = planText
    .split('\n')
    .map(l => l.replace(/^\d+[\.\)]\s*/, '').trim())
    .filter(l => l.length > 0 && !l.startsWith('Review'));

  return { plan: planText, steps };
}

export async function executeReviewerWorker(
  context: WorkerContext,
  originalRequest: string,
  proposedAnswer: string,
): Promise<ReviewerResult> {
  const reviewMessages: Message[] = [
    { role: 'user', content: `Original request: ${originalRequest}\n\nProposed answer/code:\n${proposedAnswer}\n\nReview the proposed changes for issues.` },
  ];

  const { response } = await sendVia9Router(
    context.config,
    context.taskKind as any,
    reviewMessages,
    REVIEWER_SYSTEM_PROMPT,
    context.signal,
  );

  const reviewText = response?.message || '';
  const passed = reviewText.includes('REVIEW PASSED');
  const issues = reviewText
    .split('\n')
    .filter(l => /^\d+[\.\)]|\-\s/.test(l) || l.toLowerCase().includes('missing') || l.toLowerCase().includes('error'))
    .filter(l => l.length > 10);

  return { passed, issues, reviewedText: reviewText };
}

export interface QualityGateInput {
  answer: string;
  userText: string;
  taskKind: string;
}

export function checkQualityGate(input: QualityGateInput): { passed: boolean; issues: string[] } {
  const quality = evaluateAnswerQuality({
    answer: input.answer,
    userText: input.userText,
    language: input.userText ? (/[\u0600-\u06FF]/.test(input.userText) ? 'ar' : 'en') : 'en',
    taskKind: input.taskKind,
  });
  const issues: string[] = quality.issues.map(i => i.code);
  return { passed: quality.ok, issues };
}

export async function executeOrchestrationPipeline(
  config: HysaConfig,
  orchestrationPlan: OrchestrationPlan,
  messages: Message[],
  systemPrompt: string,
  signal?: AbortSignal,
): Promise<{
  finalAnswer: string;
  plannerSteps?: string[];
  reviewerIssues?: string[];
  qualityIssues?: string[];
  provider: string;
  model: string;
  fallbackEvents: string[];
}> {
  const workerRoles = orchestrationPlan.workerRoles;
  const taskKind = orchestrationPlan.taskKind;
  const context: WorkerContext = { config, taskKind, messages, systemPrompt, signal };

  let plannerSteps: string[] | undefined;
  let reviewerIssues: string[] | undefined;
  let qualityIssues: string[] | undefined;
  let finalAnswer = '';
  let provider = '';
  let model = '';
  const allFallbackEvents: string[] = [];

  // Phase 1: Planner worker
  if (workerRoles.includes('planner')) {
    const planner = await executePlannerWorker(context);
    plannerSteps = planner.steps;
    // Inject plan as context for code_agent
    if (plannerSteps.length > 0) {
      const planMsg: Message = { role: 'user', content: `Execution plan:\n${plannerSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}` };
      messages.push(planMsg);
    }
  }

  // Phase 2: Code agent / main executor
  const { response: mainResponse, fallbackEvents } = await sendVia9Router(config, taskKind as any, messages, systemPrompt, signal);
  allFallbackEvents.push(...fallbackEvents);
  if (mainResponse) {
    finalAnswer = mainResponse.message;
    provider = mainResponse.provider || provider;
    model = mainResponse.model || model;
  }

  // Phase 3: Reviewer worker
  if (workerRoles.includes('reviewer') && finalAnswer) {
    const userText = messages.filter(m => m.role === 'user').pop()?.content || '';
    const reviewer = await executeReviewerWorker(context, userText, finalAnswer);
    reviewerIssues = reviewer.issues;
    if (!reviewer.passed && reviewer.issues.length > 0) {
      // Inject reviewer feedback and re-ask
      const fixPrompt: Message = {
        role: 'user',
        content: `The reviewer found these issues with your response:\n${reviewer.issues.join('\n')}\n\nPlease fix them and provide a corrected version.`,
      };
      const { response: fixResponse } = await sendVia9Router(config, taskKind as any, [...messages, fixPrompt], systemPrompt, signal);
      if (fixResponse?.message) {
        finalAnswer = fixResponse.message;
      }
    }
  }

  // Phase 4: Quality gate
  if (finalAnswer) {
    const userText = messages.filter(m => m.role === 'user').pop()?.content || '';
    const quality = checkQualityGate({ answer: finalAnswer, userText, taskKind });
    qualityIssues = quality.issues;
    if (!quality.passed && quality.issues.includes('empty_response')) {
      const { response: retryResponse } = await sendVia9Router(config, taskKind as any, messages, systemPrompt, signal);
      if (retryResponse?.message && retryResponse.message.trim()) {
        finalAnswer = retryResponse.message;
      }
    }
  }

  return {
    finalAnswer,
    plannerSteps,
    reviewerIssues,
    qualityIssues,
    provider,
    model,
    fallbackEvents: allFallbackEvents,
  };
}
