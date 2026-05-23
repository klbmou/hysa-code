# Contributing to Awesome Open Source AI

Thank you for considering contributing to this curated list. We maintain high quality standards for tools with evidence of real-world value.

---

## Quality Bar

This is not a directory of every open-source AI project. We curate tools that have survived real-world usage, earned community trust, and demonstrate sustained excellence.

### Inclusion Criteria

Projects should satisfy all of the following criteria. Maintainers may make exceptions for projects with clear technical importance.

| Criterion | Threshold | Why It Matters |
|-----------|-----------|----------------|
| **⭐ GitHub Stars** | 1000+ | Indicates broad community adoption and trust |
| **🔄 Active Development** | Meaningful commits within last 6 months | Continuously evolving, not abandoned |
| **🏭 Production Usage** | Evidence of real-world deployment | Case studies, integrations, production issues/PRs |
| **📚 Quality Standards** | Proper docs, tests, releases | Not a thrown-together experiment |

### Exceptions

Projects that do not meet every criterion may still be considered when there is strong evidence of technical importance or broad adoption.

- Maintainer override - Reserved for exceptional cases with significant production traction or major organizational backing.

---

## Curation Philosophy: "Current Best"

This list represents **"what you should know about now"** — not a historical archive.

### Replace, Don't Accumulate

When a newer version clearly supersedes an existing entry in the same category:

| Scenario | Action | Example |
|----------|--------|---------|
| **New major version** | Update existing entry | PyTorch 2.4 → 2.5: Edit the line, don't add both |
| **Minor bump** | Skip unless significant | v1.2 → v1.3: Not worth a PR |
| **Both versions warranted** | Rare exception | Python 3.11/3.12 both deployed; SD 1.5 vs XL (different use cases) |

**The test:** Would a practitioner looking at this list today care about *both* versions, or just the current one?

For rapidly evolving families (foundation models, frameworks with numbered releases), always update the existing entry rather than appending. The list stays lean and relevant.

### Maintenance Cleanup Rule

- **Older than 6 months since latest push:** remove from the list completely
- **Active within 6 months and 1000+ stars:** eligible to remain in the main README
- **Active within 6 months but below 1000 stars:** not eligible for unattended README auto-maintenance; handle separately as maintainer/community work if desired

This applies to existing entries as well as new submissions. The list is actively pruned, not just appended.

---

## What We're Looking For

### ✅ Quality Indicators

- **Sustained adoption** - Growing star count over time, not a spike
- **Production testimonials** - Companies/teams using it in production
- **Ecosystem integration** - Referenced by other major projects
- **Responsive maintenance** - Active issue resolution, regular releases
- **Clear differentiation** - Solves a specific problem better than alternatives
- **Documentation quality** - Proper setup guides, API docs, examples

### 🚩 Disqualifying Red Flags

- Marketing-heavy descriptions without substance
- "Revolutionary" / "next-gen" / "game-changing" hype language
- Single-contributor repos with manufactured star counts
- Forks with minor feature additions claiming to be new projects
- No production users or real-world usage evidence
- Abandoned projects seeking attention
- AI-generated slop (low-effort boilerplate projects)

---

## Submission Process

### Before Submitting

1. **Verify your project meets the inclusion criteria** - if not, consider the [Emerging list](EMERGING.md) for newer projects
2. **Check for duplicates** - search the README and EMERGING lists first
3. **Ensure correct categorization** - place in the most specific section
4. **Write a factual description** - one sentence, no fluff
5. **Run the validator locally before submitting** - `python3 tools/validate_awesome.py` (set `GITHUB_TOKEN` to check stars and last push dates)
6. **Expect CI to enforce structure** - GitHub Actions runs `python3 tools/validate_awesome.py --skip-remote` on PRs, and full GitHub-backed validation on `main`

### Automation Note

- Community PRs are reviewed by maintainers before merging.

### PR Requirements

```markdown
- [Project Name](https://github.com/owner/repo) - Factual one-sentence description. ![GitHub stars](https://img.shields.io/github/stars/owner/repo?style=social)
```

**Good:**
> "High-performance vector search engine built in Rust with hybrid filtering and cloud-native architecture."

**Bad:**
> "The revolutionary next-generation AI-powered vector database disrupting the industry with bleeding-edge performance."

### Required PR Description

Your PR must include:

```markdown
## Project: [Name]

### Inclusion Criteria Checklist

- [ ] **Inclusion criteria:** Criteria met
  - ⭐ Stars: [count] (threshold: 1000+)
  - 🔄 Active: [last push date] (within 6 months)
  - 🏭 Production: [evidence link] (case study/integration)
  - 📚 Quality: [docs link] (tests/releases)

### Evidence of Production Usage
<!-- Links to case studies, integrations, or production usage -->

### Why This Belongs
<!-- Explain which criteria are met and why the project is useful -->

### Category
<!-- Which section this belongs in -->
```

---

## Categories & Quality Benchmarks

Each category has established quality benchmarks. Your submission should be comparable in quality to existing entries:

### 1. Core Frameworks & Libraries
- **Benchmarks:** PyTorch (80K+ ⭐), Transformers (150K+ ⭐), LangChain (90K+ ⭐)
- **Bar:** Industry-standard adoption or clear performance advantage

### 2. Open Foundation Models
- **Benchmarks:** DeepSeek-V3 (90K+ ⭐), Qwen (50K+ ⭐), llama.cpp (100K+ ⭐)
- **Bar:** State-of-the-art performance or unique architectural innovation

### 3. Inference Engines & Serving
- **Benchmarks:** vLLM (50K+ ⭐), Ollama (100K+ ⭐), TGI (30K+ ⭐)
- **Bar:** Production-grade performance, scalable architecture

### 4. Agentic AI & Multi-Agent Systems
- **Benchmarks:** LangGraph (10K+ ⭐), AutoGen (35K+ ⭐), CrewAI (25K+ ⭐)
- **Bar:** Real agent deployments, not just agent-themed projects

### 5. RAG & Knowledge
- **Benchmarks:** Chroma (20K+ ⭐), Qdrant (25K+ ⭐), Weaviate (15K+ ⭐)
- **Bar:** Performance benchmarks, production deployments

### 6. Generative Media Tools
- **Benchmarks:** ComfyUI (60K+ ⭐), Stable Diffusion (80K+ ⭐), AnimateDiff (15K+ ⭐)
- **Bar:** Professional-grade output quality, artist community adoption

### 7. Training & Fine-tuning Ecosystem
- **Benchmarks:** LLaMA-Factory (40K+ ⭐), Unsloth (25K+ ⭐), Axolotl (15K+ ⭐)
- **Bar:** Proven training efficiency gains, adoption by AI labs

### 8. MLOps / LLMOps & Production
- **Benchmarks:** MLflow (20K+ ⭐), Kubeflow (15K+ ⭐), BentoML (10K+ ⭐)
- **Bar:** Enterprise deployment patterns, observability features

### 9. Evaluation, Benchmarks & Datasets
- **Benchmarks:** lm-evaluation-harness (10K+ ⭐), DeepEval (5K+ ⭐)
- **Bar:** Credible evaluation methodology, research community usage

### 10. AI Safety, Alignment & Interpretability
- **Benchmarks:** TransformerLens (10K+ ⭐), Garak (5K+ ⭐)
- **Bar:** Published research backing, security community adoption

### 11. Specialized Domains
- **Benchmarks:** OpenCV (80K+ ⭐), YOLO (40K+ ⭐), Gymnasium (10K+ ⭐)
- **Bar:** Domain expertise, professional practitioner adoption

### 12. User Interfaces & Self-hosted Platforms
- **Benchmarks:** Open WebUI (50K+ ⭐), AnythingLLM (30K+ ⭐), LibreChat (20K+ ⭐)
- **Bar:** Active user community, polished UX, stable releases

### 13. Developer Tools & Integrations
- **Benchmarks:** Continue (20K+ ⭐), Aider (25K+ ⭐), Tabby (25K+ ⭐)
- **Bar:** Daily developer workflow integration, IDE ecosystem presence

### 14. Resources & Learning
- **Benchmarks:** High-signal courses, communities, newsletters, and benchmark resources practitioners actively rely on
- **Bar:** Strong current relevance, clear utility, and sustained practitioner value

---

## Maintainer Discretion

The maintainer reserves final judgment on all submissions, including:

- **Rejecting** projects that technically meet criteria but lack production substance
- **Accepting** exceptional projects that may fall short on one criterion but demonstrate unique innovation with strong backing
- **Removing** existing entries if quality degrades or project becomes abandoned
- Moving tools from the emerging list to the main list as they mature

**Remember:** Meeting ALL criteria guarantees consideration, not acceptance. This list is about trust and proven value. Maintainer override is reserved for truly exceptional cases only.

---

## Emerging & Experimental Projects

Have a promising project that doesn't meet the main list criteria yet?

We maintain the **[EMERGING.md](EMERGING.md)** list for:
- Active projects with **fewer than 1000 stars**
- Early-stage projects with strong potential
- Experimental research implementations
- Niche tools solving specific problems
- Newer repos that haven't been around long but show promise

### Emerging Tier Criteria

| Criterion | Threshold | Why It Matters |
|-----------|-----------|----------------|
| **⭐ GitHub Stars** | Fewer than 1000 | Below main list threshold but showing traction |
| **🔄 Active Development** | Latest push within 6 months | Alive and evolving |
| **📝 Innovation** | Clear unique approach | Not a "me too" project |
| **📚 Quality** | Basic docs, working code | Professional intent |
| **🔮 Potential** | Maintainer discretion | Gut check on future inclusion |

### Emerging → Main List Promotion Path

Projects can graduate from Emerging to the main list when they meet all main list criteria:

| Criterion | Emerging | Main List |
|-----------|----------|-------|
| Stars | <1000 | 1000+ |
| Activity | 6 months | 6 months |
| Production | Early adopters | Real deployments |
| Quality | Basic | Full (docs/tests/releases) |

**Promotion process:**
1. Maintainer identifies project as ready (or author opens "Promotion Request" issue)
2. Project is added to the appropriate category in the main list
3. Project stays in Emerging for 30 days with a "🎓 Graduated" badge
4. Then removed from Emerging to keep the list fresh

### How to Submit to Emerging

Same process as the main list, but lower thresholds. In your PR, specify this is for Emerging:

```markdown
## Project: [Name]

### Emerging Criteria Checklist

- [ ] **Below 1000 stars** (otherwise submit to Elite)
- [ ] **Active** in last 6 months
- [ ] **Innovation** - what's unique about this approach
- [ ] **Quality** - basic docs and working code
- [ ] **License** - OSI-approved

### Target List
- [ ] Main list (1000+ stars, active within 6 months, production usage)
- [x] Emerging List (active within 6 months, under 1000 stars, promising)

### Why This Belongs in Emerging
<!-- Explain the concept, innovation, and potential -->
```

### Emerging List Philosophy

- **Curated, not exhaustive** — still say no to low-effort projects
- **Fresh eyes welcome** — newer projects can get visibility
- **Quality over quantity** — 5 good entries > 50 mediocre ones
- **Promotion ready** — design entries to smoothly graduate to the main list

---

## Questions?

Open an issue for discussion before submitting borderline cases. We're happy to help evaluate whether your project fits the main list or should wait for the emerging list.

---

*Last updated: April 2026*  
*Quality standard: maintained, documented, and useful in practice*
