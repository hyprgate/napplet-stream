export interface ReactionGroup {
  content: string;
  count: number;
  imageUrl?: string;
  shortcode?: string;
}

export interface EngagementCounts {
  reactions: number;
  reactionGroups: ReactionGroup[];
  comments: number;
  zaps: number;
  zapMillisats: number;
}
