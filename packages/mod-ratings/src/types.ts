export interface GlickoRating {
  mu: number;
  phi: number;
  sigma: number;
  wins: number;
  losses: number;
  lastActive: string;
}

export interface EngineMeta {
  firstSeen: string;
  lastActive: string;
  matchCount: number;
  derivedFrom: string|null;
  versions: string[];
}

export interface RatingRecord {
  global: Record<string,GlickoRating>;
  byMode: {forge:Record<string,GlickoRating>,brainstorm:Record<string,GlickoRating>,tribunal:Record<string,GlickoRating>,critique:Record<string,GlickoRating>};
  byTaskClass: Record<string,Record<string,GlickoRating>>;
  engineMeta: Record<string,EngineMeta>;
  lastUpdated: string;
}
