export function sportsProviderStatus() {
  return {
    balldontlie: Boolean(process.env.SPORTS_API_KEY_A || process.env.BALLDONTLIE_FIFA_API_KEY),
    apiFootball: Boolean(process.env.SPORTS_API_KEY_B || process.env.SPORTS_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    supabase: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  };
}

export function sportsProviderLabels() {
  const status = sportsProviderStatus();
  return [
    { label: "BALLDONTLIE World Cup", ready: status.balldontlie },
    { label: "API-Football fallback", ready: status.apiFootball },
    { label: "OpenAI summaries", ready: status.openai },
    { label: "Supabase login", ready: status.supabase },
  ];
}
