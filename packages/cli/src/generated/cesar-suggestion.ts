export interface SuggestionResult {
  action: string|null;
  rest: string;
  hardened?: boolean;
  tribunalMode?: string;
  team?: boolean;
  membersPerSide?: number;
}







export function parseSuggestion(response: string): SuggestionResult {
  // Search for [SUGGEST:mode] anywhere in the first 150 chars — engines put
  // varying amounts of text between confidence and the marker.
  const searchArea = response.slice(0, 150);
  const match = searchArea.match(/\[(SUGGEST|DELEGATE):([\w-]+)\]/i);
  if (!match) {
    // ── Keyword fallback: catch natural language delegation ──
    // Search last 600 chars — models often put delegation at the end after narration
    const nlArea = response.slice(-600).toLowerCase();
    // Optional filler between intent verb and mode word: "I suggest we *launch a* forge"
    const FILLER = '(?:(?:use|launch|start|open|run|set up|do)\\s+(?:a\\s+)?)?';
    const INTENT = `(?:i(?:'ll| will| should| recommend| suggest(?:ing)?)\\s+(?:we\\s+)?(?:a\\s+)?${FILLER}|let(?:'s| me| us)\\s+(?:a\\s+)?${FILLER}|this (?:needs?|calls for|warrants) (?:a )?|delegat(?:e|ed|ing) (?:this )?to (?:the )?|send (?:this )?to |launch(?:ing)?\\s+(?:a\\s+)?|going with (?:a )?|proceed(?:ing)? with (?:a )?)`;
    const NL_PATTERNS: Array<{ re: RegExp; action: string; hardened?: boolean; team?: boolean }> = [
      // All patterns require intent verbs to avoid matching descriptions
      { re: new RegExp(`\\b(?:${INTENT})team[\\s-]forge\\b`), action: 'team-forge', team: true },
      { re: new RegExp(`\\b(?:${INTENT})forge[\\s-]hardened\\b`), action: 'forge', hardened: true },
      { re: new RegExp(`\\b(?:${INTENT})forge\\b`), action: 'forge' },
      { re: new RegExp(`\\b(?:${INTENT})team[\\s-]brainstorm\\b`), action: 'team-brainstorm', team: true },
      { re: new RegExp(`\\b(?:${INTENT})brainstorm\\b`), action: 'brainstorm' },
      { re: new RegExp(`\\b(?:${INTENT})team[\\s-]tribunal\\b`), action: 'team-tribunal', team: true },
      { re: new RegExp(`\\b(?:${INTENT})tribunal[\\s-](adversarial|synthesis|steelman|socratic|red[\\s-]team|postmortem)\\b`), action: 'tribunal' },
      { re: new RegExp(`\\b(?:${INTENT})tribunal\\b`), action: 'tribunal' },
      { re: new RegExp(`\\b(?:${INTENT}|open(?:ing)?\\s+(?:a\\s+)?)campfire\\b`), action: 'campfire' },
      { re: new RegExp(`\\b(?:${INTENT}|full\\s+)(?:team[\\s-])?pipeline\\b`), action: 'pipeline' },
      // Past-tense: "delegated to pipeline", "going with forge"
      { re: /\bdelegated to (?:the )?(?:full )?pipeline\b/, action: 'pipeline' },
      { re: /\bdelegated to (?:the )?forge\b/, action: 'forge' },
      { re: /\bdelegated to (?:the )?brainstorm\b/, action: 'brainstorm' },
      { re: /\bdelegated to (?:the )?tribunal\b/, action: 'tribunal' },
    ];
    for (const pat of NL_PATTERNS) {
      const nlMatch = nlArea.match(pat.re);
      if (nlMatch) {
        const matchIdx = nlArea.indexOf(nlMatch[0]);
        const rest = response.slice(matchIdx + nlMatch[0].length).trim();
        let action = pat.action;
        let hardened = pat.hardened ?? false;
        let team = pat.team ?? false;
        let tribunalMode: string | undefined;
        // Extract tribunal mode from capture group
        if (action === 'tribunal' && nlMatch[1]) {
          tribunalMode = nlMatch[1].replace(/\s/g, '-');
        }
        return { action, rest, hardened, tribunalMode, team };
      }
    }
    return { action: null, rest: response };
  }
  
  const raw = match[2].toLowerCase();
  const idx = response.indexOf(match[0]);
  const rest = response.slice(idx + match[0].length).trim();
  
  // Parse compound mode name into action + options
  let action = raw;
  let hardened = false;
  let tribunalMode: string | undefined;
  let team = false;
  
  // Extract team prefix
  if (action.startsWith('team-')) {
    team = true;
    action = action.slice(5); // remove 'team-'
  }
  
  // Extract -hardened suffix from forge
  if (action === 'forge-hardened') {
    action = 'forge';
    hardened = true;
  }
  
  // Extract tribunal mode suffix
  const tribunalModes = ['adversarial', 'synthesis', 'steelman', 'socratic', 'red-team', 'postmortem'];
  for (const mode of tribunalModes) {
    if (action === `tribunal-${mode}`) {
      action = 'tribunal';
      tribunalMode = mode;
      break;
    }
  }
  
  // Reconstruct action with team prefix for routing
  if (team) action = `team-${action}`;
  
  return { action, rest, hardened, tribunalMode, team };
}

