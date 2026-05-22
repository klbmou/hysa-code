import { loadConfig, saveConfig } from './dist/config/keys.js';
import { resetHealth } from './dist/ai/model-health.js';
import { startWebServer, getServerRef } from './dist/web/server.js';

async function main() {
  resetHealth();

  // Download test image
  const imgResp = await fetch('https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/300px-PNG_transparency_demonstration_1.png');
  const imgBuf = Buffer.from(await imgResp.arrayBuffer());
  const imgDataUrl = `data:image/png;base64,${imgBuf.toString('base64')}`;
  console.log(`Image: ${imgBuf.length} bytes`);

  // Set config to Gemini
  let config = loadConfig();
  const oldProv = config.currentProvider;
  const oldModel = config.currentModel;
  config.currentProvider = 'gemini';
  config.currentModel = 'gemini-1.5-flash';
  saveConfig(config);
  console.log(`Config: ${config.currentProvider}/${config.currentModel}`);
  console.log(`(was ${oldProv}/${oldModel})`);

  // Start server
  resetHealth();
  await startWebServer(8790);
  const API = 'http://localhost:8790';

  // Test 1: Non-vision hint
  console.log('\n--- Test 1: Non-vision hint ---');
  config.currentProvider = 'openrouter';
  config.currentModel = 'qwen/qwen3-coder:free';
  saveConfig(config);
  let t = Date.now();
  let r = await (await fetch(`${API}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    messages: [{ role: 'user', content: 'what is this image' }],
    attachments: [{ name: 't.png', ext: '.png', size: imgBuf.length, kind: 'image', dataUrl: imgDataUrl }]
  }) })).json();
  console.log(`  Time: ${((Date.now()-t)/1000).toFixed(1)}s`);
  console.log(`  ${r.message?.includes('vision') ? '✓ VISION HINT' : '✗ Unexpected: ' + (r.message||'').slice(0,100)}`);

  // Test 2: Gemini vision — ماهذا؟
  console.log('\n--- Test 2: Gemini vision "ماذا يوجد في هذه الصورة؟" ---');
  config.currentProvider = 'gemini';
  config.currentModel = 'gemini-1.5-flash';
  saveConfig(config);
  resetHealth();
  t = Date.now();
  try {
    r = await (await fetch(`${API}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      messages: [{ role: 'user', content: 'ماذا يوجد في هذه الصورة؟' }],
      attachments: [{ name: 't.png', ext: '.png', size: imgBuf.length, kind: 'image', dataUrl: imgDataUrl }]
    }) })).json();
    console.log(`  Time: ${((Date.now()-t)/1000).toFixed(1)}s`);
    console.log(`  Response: ${(r.message||'NO MSG').slice(0,200)}`);
    if (r.error) console.log(`  Error: ${r.error.slice(0,150)}`);
    const ok = r.message && (r.message.includes('PNG') || r.message.includes('transparen') || r.message.includes('checker') || r.message.includes('صورة') || r.message.includes('شكل') || r.message.includes('خلفية'));
    console.log(`  ${ok || r.message ? '✓ Gemini responded' : '⚠ No useful response'}`);
  } catch(e) { console.log(`  ✗ ${e.message}`); }

  // Test 3: Gemini extract text
  console.log('\n--- Test 3: Gemini "استخرج النص من الصورة" ---');
  resetHealth();
  t = Date.now();
  try {
    r = await (await fetch(`${API}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      messages: [{ role: 'user', content: 'استخرج النص من الصورة' }],
      attachments: [{ name: 't.png', ext: '.png', size: imgBuf.length, kind: 'image', dataUrl: imgDataUrl }]
    }) })).json();
    console.log(`  Time: ${((Date.now()-t)/1000).toFixed(1)}s`);
    console.log(`  Response: ${(r.message||'NO MSG').slice(0,200)}`);
    if (r.error) console.log(`  Error: ${r.error.slice(0,150)}`);
  } catch(e) { console.log(`  ✗ ${e.message}`); }

  // Test 4: PDF/text still works
  console.log('\n--- Test 4: PDF/text attachment ---');
  resetHealth();
  t = Date.now();
  try {
    r = await (await fetch(`${API}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      messages: [{ role: 'user', content: 'الملخص' }],
      attachments: [{ name: 'test.txt', ext: '.txt', size: 68, kind: 'text', textContent: 'هذا النص هو وثيقة اختبار باللغة العربية. تحتوي على معلومات مهمة حول الذكاء الاصطناعي.' }]
    }) })).json();
    console.log(`  Time: ${((Date.now()-t)/1000).toFixed(1)}s`);
    console.log(`  Response: ${(r.message||'NO MSG').slice(0,200)}`);
    const ok = r.message && (r.message.includes('الذكاء') || r.message.includes('عربي') || r.message.includes('نص'));
    console.log(`  ${ok ? '✓ PDF/text works' : '⚠ May have issues'}`);
  } catch(e) { console.log(`  ✗ ${e.message}`); }

  // Cleanup
  const ref = getServerRef();
  if (ref) ref.close();
  config.currentProvider = 'openrouter';
  config.currentModel = 'qwen/qwen3-coder:free';
  saveConfig(config);
  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
