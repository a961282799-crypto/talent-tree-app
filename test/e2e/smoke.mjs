/**
 * Browser smoke test: the web preview build (example data, no API key) at
 * phone size, walking through the main screens. Run with `npm run test:e2e`.
 * Fails on any page error or failed step.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { preview } from 'vite'
import { chromium } from 'playwright'

const server = await preview({ preview: { port: 4179, strictPort: true }, build: { outDir: 'dist-preview' }, logLevel: 'error' })
const url = 'http://localhost:4179/'
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 390, height: 820 }, locale: 'zh-CN', hasTouch: false })
const page = await context.newPage()
const problems = []
page.on('pageerror', e => problems.push(`page error: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') problems.push(`console: ${m.text()}`) })

const step = async (name, fn) => {
  try {
    await fn()
    console.log(`ok - ${name}`)
  } catch (error) {
    console.log(`not ok - ${name}\n  ${String(error.message).split('\n')[0]}`)
    problems.push(name)
    await page.screenshot({ path: join(tmpdir(), `smoke-${name.replace(/\W+/g, '-')}.png`) }).catch(() => {})
  }
}

try {
  await page.goto(url)
  await step('welcome guide can be skipped', async () => {
    await page.locator('.onb-skip').click()
    await page.getByRole('button', { name: '先逛逛，稍后再设置' }).click()
    await page.locator('.goal-card').first().waitFor()
  })

  await step('a talent tree opens and a point shows its card', async () => {
    await page.locator('.goal-card').first().click()
    await page.locator('.tt-node').first().waitFor()
    await page.locator('.tt-node', { hasText: '导数的定义' }).click()
    await page.locator('.tt-card').waitFor()
    await page.locator('.tt-card .tt-tag', { hasText: '天后复习' }).waitFor()
    await page.locator('.topbar .icon-btn').first().click()
  })

  await step('the knowledge map finds a point by name', async () => {
    await page.locator('.map-card').click()
    await page.getByRole('button', { name: '搜索知识点' }).click()
    await page.getByPlaceholder('输入知识点名称').fill('泰勒')
    await page.locator('.map-results .sheet-item').first().click()
    await page.locator('.tt-card .tt-card-title', { hasText: '泰勒公式' }).waitFor()
    await page.locator('.topbar .icon-btn').first().click()
  })

  await step('chats can be searched and renamed; replies can be copied', async () => {
    await page.locator('.tabbar button').nth(1).click()
    await page.getByPlaceholder('搜索对话').fill('0.999')
    if (await page.locator('.list-item').count() !== 1) throw new Error('expected one match')
    await page.getByPlaceholder('搜索对话').fill('完全不存在的词')
    await page.getByText('没有找到').waitFor()
    await page.getByPlaceholder('搜索对话').fill('')
    await page.locator('.list-item').first().click()
    await page.locator('.msg-action').first().waitFor()
    await page.locator('.topbar-title-btn').click()
    await page.locator('.dialog input').fill('我的微积分')
    await page.locator('.dialog .btn-primary').click()
    await page.locator('.topbar-title-btn', { hasText: '我的微积分' }).waitFor()
    await page.locator('.topbar .icon-btn').first().click()
    await page.locator('.list-title', { hasText: '我的微积分' }).waitFor()
  })

  await step('reading size applies', async () => {
    await page.locator('.tabbar button').nth(2).click()
    await page.getByRole('radio', { name: '大', exact: true }).click()
    if (await page.evaluate(() => document.documentElement.dataset.text) !== 'large') throw new Error('data-text not set')
  })

  await step('importing asks whether to merge or replace', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tt-'))
    const file = join(dir, 'backup.json')
    writeFileSync(file, JSON.stringify({ app: 'talent-tree', version: 2, knowledge: { nodes: { new_point: { id: 'new_point', name: '新知识点', type: 'concept', summary: '', prerequisites: [] } } }, chats: [] }))
    await page.setInputFiles('input[accept="application/json,.json"]', file)
    await page.locator('.dialog').waitFor()
    await page.getByRole('button', { name: '合并' }).click()
    await page.locator('.app-toast', { hasText: '已导入 1 个知识点' }).waitFor()
  })

  await step('clearing everything asks first, and Cancel keeps the data', async () => {
    await page.getByRole('button', { name: '清空所有数据' }).click()
    await page.locator('.dialog .btn-danger').waitFor()
    await page.locator('.dialog').getByRole('button', { name: '取消' }).click()
    await page.locator('.tabbar button').nth(0).click()
    await page.locator('.goal-card').first().waitFor()
  })
} finally {
  await browser.close()
  await new Promise(resolve => server.httpServer.close(resolve))
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log('\nsmoke test passed')
