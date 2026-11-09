/**
 * AI services the app can talk to. All of them speak the OpenAI-compatible
 * chat-completions API with tool calls; only the address, key and model differ.
 * Model ids change often: the lists are suggestions, any id can be typed in.
 */
export const PROVIDERS = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'qwen',
    name: { zh: '通义千问（阿里云百炼）', en: 'Qwen (Alibaba Cloud Model Studio)' },
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-plus', 'qwen-max', 'qwen3.8-max'],
    keyUrl: 'https://bailian.console.aliyun.com/',
  },
  {
    id: 'glm',
    name: { zh: '智谱 GLM', en: 'Zhipu GLM' },
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-5.1', 'glm-5'],
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'kimi',
    name: { zh: 'Kimi（月之暗面）', en: 'Kimi (Moonshot AI)' },
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-k3'],
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'doubao',
    name: { zh: '豆包（火山方舟）', en: 'Doubao (Volcengine Ark)' },
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: ['doubao-seed-1-8-251228'],
    keyUrl: 'https://console.volcengine.com/ark',
  },
  {
    id: 'siliconflow',
    name: { zh: '硅基流动', en: 'SiliconFlow' },
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-7B-Instruct'],
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-5.5', 'gpt-5.4-mini'],
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'custom',
    name: { zh: '自定义（OpenAI 兼容）', en: 'Custom (OpenAI-compatible)' },
    baseUrl: '',
    models: [],
    keyUrl: '',
  },
]

export const DEFAULT_PROVIDER = 'deepseek'

export function providerById(id) {
  return PROVIDERS.find(p => p.id === id) ?? PROVIDERS[0]
}

export function providerName(provider, lang) {
  return typeof provider.name === 'string' ? provider.name : provider.name[lang] ?? provider.name.en
}

/** The address, key and model to use right now. */
export function activeAI(settings) {
  const preset = providerById(settings.provider)
  const own = settings.providers?.[preset.id] ?? {}
  return {
    provider: preset.id,
    apiKey: own.apiKey ?? '',
    baseUrl: own.baseUrl || preset.baseUrl,
    model: own.model || preset.models[0] || '',
  }
}
