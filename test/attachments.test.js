import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prepareMessage, PDF_CHAR_LIMIT } from '../src/attachments.js'

const ai = { apiKey: 'k', baseUrl: 'https://example.invalid', model: 'm', visionModel: '' }

test('a text PDF reaches the tutor as text, with its page count; no vision call needed', async () => {
  const pdf = { id: '1', kind: 'pdf', name: '教材.pdf', pages: 2, readPages: 2, text: '— 第 1 页 —\n拉格朗日中值定理……', scanned: false, scans: [], thumb: 'data:x' }
  const { content, meta } = await prepareMessage({ text: '帮我按这一章学', attachments: [pdf], ai })
  assert.match(content, /^帮我按这一章学\n\n【[^】]*教材\.pdf[^】]*2[^】]*】\n— 第 1 页 —\n拉格朗日中值定理/)
  assert.deepEqual(meta, [{ kind: 'pdf', name: '教材.pdf', thumb: 'data:x', pages: 2 }])
})

test('a long PDF says only part of it was read', async () => {
  const pdf = { id: '1', kind: 'pdf', name: 'big.pdf', pages: 300, readPages: 40, text: 'x'.repeat(PDF_CHAR_LIMIT), scanned: false, scans: [] }
  const { content } = await prepareMessage({ text: '', attachments: [pdf], ai })
  assert.match(content, /300/)
  assert.match(content, /40/)
})

test('images need a vision model; without one the learner gets a clear error and nothing is sent', async () => {
  const img = { id: '2', kind: 'image', name: 'q.jpg', image: 'data:image/jpeg;base64,AAAA', thumb: 't' }
  await assert.rejects(prepareMessage({ text: '这题怎么做', attachments: [img], ai }), err => err.code === 'no-vision')
})
