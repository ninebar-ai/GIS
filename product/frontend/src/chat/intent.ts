import { sanitizeRecipe } from '../filters'

/** Every type applyIntent (app.js) actually has a branch for. */
const INTENT_TYPES = new Set(['recipe', 'select', 'qa', 'neighbors', 'drop', 'audit', 'help', 'empty'])

/**
 * Validate a recipe patch without inflating it into a whole recipe.
 *
 * sanitizeRecipe always returns every key (it spreads over defaultRecipe), so
 * running a patch through it and keeping the result would turn "also show
 * coverage holes" back into a full replacement. Validate through the one
 * sanitizer, then project back down to the keys the caller actually named.
 */
export function sanitizePatch(src, inv) {
  if (!src || typeof src !== 'object') return {}
  const full = sanitizeRecipe(src, inv)
  const out = {}
  for (const k of Object.keys(src)) if (k in full) out[k] = full[k]
  return out
}

export function validateIntent(intent, inv) {
  if (!intent || typeof intent !== 'object') {
    return {
      type: 'qa',
      narrate: "I don't know how to do that. Try: sites in alarm, show drive test, or tier-1 neighbours for TOK_001.",
      _route: 'refusal',
    }
  }
  // An unrecognised type falls through every branch of applyIntent and produces
  // narration with no map effect. Name the degraded state instead of guessing.
  if (!INTENT_TYPES.has(intent.type)) {
    return {
      type: 'qa',
      narrate: `I understood the words but not the action${intent.type ? ` ("${intent.type}")` : ''}. Try: sites in alarm, show drive test, or tier-1 neighbours for TOK_001.`,
      _route: 'refusal',
    }
  }
  const out = { ...intent }
  // Patch, not replace — a reset intent already carries a full recipe, and
  // sanitizePatch preserves whatever set of keys it is given.
  if (out.recipe) out.recipe = sanitizePatch(out.recipe, inv)
  if (out.select && out.select !== 'PIN' && !inv.sites.some((s) => s.site_id === out.select)) {
    out.select = null
    out.narrate = `${out.narrate || 'Done.'} (Site not in this ingest — selection skipped.)`
  }
  if (out.siteId && !inv.sites.some((s) => s.site_id === out.siteId)) {
    return {
      type: 'qa',
      narrate: `I don't know site ${out.siteId} in this ingest. Select a site on the map or say "sites in alarm".`,
      _route: 'refusal',
    }
  }
  return out
}
