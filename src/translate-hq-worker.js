// One translation process (see translate-hq.js): holds the model and translates one line at a time.
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [dir, threads] = process.argv.slice(2)
const { pipeline, env } = await import(pathToFileURL(path.join(dir, 'node_modules/@huggingface/transformers/dist/transformers.node.mjs')).href)
env.cacheDir = path.join(dir, 'models')
let tr = null
const SENTENCE = /(?<=[.!?\u2026])\s+(?=["'\u201c([\u266a-]?\p{Lu})/u
const progress_callback = p => { if (p.status === 'progress' && p.total) process.send({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total }) }
const SAMPLE = ['Where are you going tonight?', 'We do not know how long it will last, so think fast.']
const say = async (to, text) => {
  // The model drops everything after the first sentence it is given, and batches of lines come out mixed up, so one sentence at a time.
  const out = []
  for (const s of text.split(SENTENCE)) out.push((await tr(s, { src_lang: 'eng_Latn', tgt_lang: to, max_new_tokens: Math.min(256, s.length + 16) }))[0].translation_text)
  return out.join(' ')
}
// Graphics card (WebGPU) when there is a really fast one, else the processor.
async function load (device) {
  if (device !== 'cpu') {
    try {
      tr = await pipeline('translation', 'Xenova/nllb-200-distilled-600M', { device: 'webgpu', dtype: 'fp16', progress_callback })
      if (device === 'gpu') return 'gpu'
      await say('tur_Latn', SAMPLE[0]) // the first run compiles the shaders
      const t = Date.now(); for (const s of SAMPLE) await say('tur_Latn', s)
      // A software renderer "works" but is slower than the processor.
      if ((Date.now() - t) / SAMPLE.length < 600) return 'gpu'
    } catch {}
    tr = null
  }
  tr = await pipeline('translation', 'Xenova/nllb-200-distilled-600M', { device: 'cpu', dtype: 'q8', session_options: { intraOpNumThreads: +threads }, progress_callback })
  return 'cpu'
}

// A server that stops without cleaning up must not leave these (about 1 GB each) running.
process.on('disconnect', () => process.exit(0))
process.on('message', async m => {
  try {
    if (m.type === 'load') process.send({ id: m.id, result: tr ? m.device : await load(m.device) })
    else process.send({ id: m.id, result: await say(m.to, m.text) })
  } catch (e) { process.send({ id: m.id, error: e.message }) }
})
