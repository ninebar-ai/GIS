import { buildSystemPromptJson, buildSystemPromptStream } from './prompts'
import { fetchWithDeadline } from './http'
import { sanitizePatch, validateIntent } from './intent'
import { getKey, getClaudeKey, getUserId, resolveReferences, rememberReferenceContext, readRefCtx, contextSite } from './memory'
import { digest, scopeEcho } from './digest'
import { parseAsk, withScopeNarrate, shouldAskModel, QUESTION_LIKE } from './parseAsk'
import { answerGeneralQuestion, defaultCopilotFallback } from './qa'

export async function interpret(text: any, inv: any, selectedId: any, opts: any = {}) {
  const section = opts.section ?? null
  const onStage = opts.onStage
  const rawText = String(text || '')
  const resolvedText = resolveReferences(rawText, inv, selectedId)
  const low = rawText.toLowerCase()
  onStage?.('Matching command…')
  if (/\b(reset|clear)\b.*\b(memory|session|chat)\b|\bclear context\b/.test(low)) {
    try {
      const userId = getUserId()
      const res = await fetchWithDeadline('/api/chat/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({ user_id: userId }),
      })
      if (res.ok) {
        const data = await res.json()
        return { type: 'qa', narrate: `Session memory reset for ${data.user_id}. Cleared ${Number(data.cleared || 0)} messages.` }
      }
      return { type: 'qa', narrate: 'Could not reset session memory right now.' }
    } catch {
      return { type: 'qa', narrate: 'Could not reset session memory right now.' }
    }
  }
  if (/\b(show|check|view)\b.*\b(memory|session|context)\b|\bmemory status\b/.test(low)) {
    try {
      const userId = getUserId()
      const res = await fetchWithDeadline(`/api/chat/memory?user_id=${encodeURIComponent(userId)}`, {
        method: 'GET',
        headers: { 'X-User-Id': userId },
      })
      if (res.ok) {
        const data = await res.json()
        return {
          type: 'qa',
          narrate: `Session memory for ${data.user_id}: ${Number(data.count || 0)} stored messages (cap ${Number(data.max_messages || 0)}).`,
        }
      }
      return { type: 'qa', narrate: 'Could not read session memory right now.' }
    } catch {
      return { type: 'qa', narrate: 'Could not read session memory right now.' }
    }
  }

  const local = parseAsk(resolvedText, inv, selectedId)
  if (local.type !== 'help') {
    rememberReferenceContext(local, inv, selectedId, resolvedText)
    onStage?.('Applying map action…')
    const intent = validateIntent(withScopeNarrate(local, inv, selectedId, section), inv)
    return { ...intent, _meta: { route: 'local', provenance: 'inventory', scope: scopeEcho(inv, selectedId, section) } }
  }

  onStage?.('Reading inventory…')
  const headers = { 'Content-Type': 'application/json' }
  const key = getKey()
  if (key) headers['X-OpenAI-Key'] = key
  const claudeKey = getClaudeKey()
  if (claudeKey) headers['X-Anthropic-Key'] = claudeKey
  headers['X-User-Id'] = getUserId()

  const toIntent = (raw) => {
    const asText = String(raw || '').trim()
    if (!asText) return local
    const stripFence = asText.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()
    const tryParse = (s) => {
      try { return JSON.parse(s) } catch { return null }
    }
    let intent = tryParse(stripFence)
    if (!intent) {
      const m = stripFence.match(/\{[\s\S]*\}/)
      if (m) intent = tryParse(m[0])
    }
    if (intent && typeof intent === 'object') {
      if (intent.recipe) intent.recipe = sanitizePatch(intent.recipe, inv)
      if (!intent.type) intent.type = 'qa'
      if (!intent.narrate) intent.narrate = 'Done.'
      return validateIntent(intent, inv)
    }
    // If model returns plain text, still provide a useful response.
    return { type: 'qa', narrate: stripFence, _route: 'model-text' }
  }

  const d = digest(inv, selectedId, section)
  onStage?.('Asking model…')
  try {
    const res = await fetchWithDeadline('/api/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        user_id: getUserId(),
        model: 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: buildSystemPromptJson(d) },
          { role: 'user', content: resolvedText },
        ],
      }),
    })
    if (res.status === 401) {
      return {
        type: 'qa',
        narrate: 'Model unavailable (no API key). Standard commands still work — try: sites in alarm, show drive test.',
        _meta: { route: 'degraded', provenance: 'none', scope: scopeEcho(inv, selectedId, section) },
      }
    }
    if (res.status === 429) {
      return {
        type: 'qa',
        narrate: 'Copilot is rate-limited. Try again in a moment, or use a quick prompt (no model needed).',
        _meta: { route: 'degraded', provenance: 'none', scope: scopeEcho(inv, selectedId, section) },
      }
    }
    if (!res.ok) {
      return {
        ...withScopeNarrate(local, inv, selectedId, section),
        _meta: { route: 'degraded', provenance: 'none', scope: scopeEcho(inv, selectedId, section) },
      }
    }
    const data = await res.json()
    const raw = data.choices?.[0]?.message?.content
    const intent = toIntent(raw)
    rememberReferenceContext(intent, inv, selectedId, resolvedText)
    const provider = data.provider || 'openai'
    return {
      ...withScopeNarrate(intent, inv, selectedId, section),
      _meta: { route: provider, provenance: 'model', scope: scopeEcho(inv, selectedId, section) },
    }
  } catch {
    return {
      ...withScopeNarrate(local, inv, selectedId, section),
      _meta: { route: 'degraded', provenance: 'none', scope: scopeEcho(inv, selectedId, section) },
    }
  }
}

/**
 * Stream a plain-text answer from /api/chat/stream. Returns null if the stream
 * could not be used at all, so the caller can fall back without narrating twice.
 */
async function streamNarration(resolvedText, inv, selectedId, { onDelta, onStage }: any = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const key = getKey()
  if (key) headers['X-OpenAI-Key'] = key
  const claudeKey = getClaudeKey()
  if (claudeKey) headers['X-Anthropic-Key'] = claudeKey
  const userId = getUserId()
  headers['X-User-Id'] = userId

  try {
    const res = await fetchWithDeadline('/api/chat/stream', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        user_id: userId,
        model: 'gpt-4o-mini',
        temperature: 0,
        messages: [
          { role: 'system', content: buildSystemPromptStream(digest(inv, selectedId)) },
          { role: 'user', content: resolvedText },
        ],
      }),
    })
    if (!res.ok || !res.body) return null
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let full = ''
    let streamDone = false
    while (!streamDone) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const chunks = buf.split('\n\n')
      buf = chunks.pop() || ''
      for (const block of chunks) {
        const line = block.split('\n').find((x) => x.startsWith('data: '))
        if (!line) continue
        const payload = line.slice(6).trim()
        if (!payload || payload === '[DONE]') continue
        let obj = null
        try { obj = JSON.parse(payload) } catch { obj = null }
        if (!obj) continue
        if (obj.delta) {
          full += String(obj.delta)
          onDelta?.(String(obj.delta))
        }
        // obj.done only marks the server's logical end-of-message — the SSE
        // connection itself is never closed server-side, so waiting for the
        // reader to report done:true here hangs forever. Break the outer read
        // loop too, and release the connection instead of leaving it dangling.
        if (obj.done) { streamDone = true; break }
      }
    }
    if (streamDone) {
      try { await reader.cancel() } catch { /* */ }
    }
    // gotContent must mean "the UI already showed this via onDelta". If the
    // provider produced nothing, the caller has to narrate the fallback itself
    // rather than silently showing an empty bubble.
    const gotContent = full.trim().length > 0
    if (!gotContent) return null
    onStage?.('Answering…')
    return full.trim()
  } catch {
    return null
  }
}

export async function interpretWithStream(text: any, inv: any, selectedId: any, opts: any = {}) {
  const section = opts.section ?? null
  const onDelta = typeof opts === 'function' ? opts : opts.onDelta
  const onStage = typeof opts === 'function' ? null : opts.onStage
  const rawText = String(text || '')
  const resolvedText = resolveReferences(rawText, inv, selectedId)
  const low = rawText.toLowerCase()
  onStage?.('Matching command…')
  if (/\b(reset|clear)\b.*\b(memory|session|chat)\b|\bclear context\b/.test(low) || /\b(show|check|view)\b.*\b(memory|session|context)\b|\bmemory status\b/.test(low)) {
    const intent = await interpret(text, inv, selectedId, { section, onStage })
    return { intent, streamed: false, meta: intent._meta || { route: 'local', provenance: 'inventory', scope: scopeEcho(inv, selectedId, section) } }
  }
  const local = parseAsk(resolvedText, inv, selectedId)
  if (local.type !== 'help') {
    rememberReferenceContext(local, inv, selectedId, resolvedText)
    onStage?.('Applying map action…')
    const intent = validateIntent(withScopeNarrate(local, inv, selectedId, section), inv)
    const meta = { route: 'local', provenance: 'inventory', scope: scopeEcho(inv, selectedId, section) }
    return { intent: { ...intent, _meta: meta }, streamed: false, meta }
  }

  const t = resolvedText.toLowerCase()
  const known = answerGeneralQuestion(resolvedText, inv)
  if (known) {
    onStage?.('Answering…')
    const intent = validateIntent(withScopeNarrate({ type: 'qa', narrate: known }, inv, selectedId, section), inv)
    const meta = { route: 'local', provenance: 'inventory', scope: scopeEcho(inv, selectedId, section) }
    return { intent: { ...intent, _meta: meta }, streamed: false, meta }
  }
  // No localStorage-key precondition: serve.py falls back to OPENAI_API_KEY /
  // ANTHROPIC_API_KEY from .env, and a genuine missing key comes back as a 401
  // that interpret() already renders as "Model unavailable (no API key)".
  // Gating on getKey() here made the server's own key unreachable from the browser.
  if (shouldAskModel(t)) {
    onStage?.('Asking model…')
    // Prose questions want a streamed answer; anything phrased as a command goes
    // through the JSON contract so it can actually move the map.
    const wantsProse = QUESTION_LIKE.test(t) && !/\b(show|list|find|highlight|filter|turn on|turn off|enable|disable)\b/.test(t)
    if (wantsProse) {
      const narrate = await streamNarration(resolvedText, inv, selectedId, { onDelta, onStage })
      if (narrate) {
        const intent = validateIntent(withScopeNarrate({ type: 'qa', narrate }, inv, selectedId, section), inv)
        rememberReferenceContext(intent, inv, selectedId, resolvedText)
        const meta = { route: 'openai-stream', provenance: 'model', scope: scopeEcho(inv, selectedId, section) }
        return { intent: { ...intent, _meta: meta }, streamed: true, meta }
      }
      // Stream unusable (no key, 401, empty completion) — fall through to JSON,
      // which surfaces the real error rather than an empty bubble.
    }
    const intent = await interpret(text, inv, selectedId, { section, onStage })
    return { intent, streamed: false, meta: intent._meta || { route: 'model', provenance: 'model', scope: scopeEcho(inv, selectedId, section) } }
  }

  // Unknown command — reply instantly with local help (no LLM wait / hang)
  onStage?.('Suggesting commands…')
  const fallback = validateIntent(withScopeNarrate({
    type: 'qa',
    narrate: (() => {
      const ctx = readRefCtx()
      const sid = contextSite(ctx, selectedId, inv)
      if (sid && ctx.lastCommand === 'neighbors') {
        return `Try: tier-1 neighbours for ${sid}, or say "now for 003", "now next", or "now previous" to switch site.`
      }
      return local.narrate || defaultCopilotFallback(inv)
    })(),
  }, inv, selectedId, section), inv)
  const meta = { route: 'local', provenance: 'none', scope: scopeEcho(inv, selectedId, section) }
  return { intent: { ...fallback, _meta: meta }, streamed: false, meta }
}

export function ensureFly(intent, inv) {
  if (!intent || intent.fly) return intent
  const next = { ...intent }
  if (next.type === 'recipe' && next.recipe) {
    const r = next.recipe
    if (r.inAlarm === true) next.fly = 'alarms'
    else if (Array.isArray(r.status) && r.status.includes('planned')) next.fly = 'planned'
    else if (r.ghLayer) next.fly = 'gh'
    else if (r.dtLayer) next.fly = next.select ? 'dt-near' : 'dt-focus'
    else if (next.select) next.fly = 'select'
  } else if (next.type === 'select' && next.select) {
    next.fly = 'select'
  } else if (next.type === 'neighbors' && next.siteId) {
    // startNeighbors flies to target
  } else if (next.type === 'qa' && next.select) {
    next.fly = 'select'
  }
  return next
}
