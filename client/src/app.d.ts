/// <reference types="@sveltejs/kit" />
/// <reference types="unplugin-icons/types/svelte" />

declare global {
  namespace App {
    interface Locals {
      id?: number;
      name?: string;
      github_username?: string;
      profile_image_url?: string;
      website_url?: string;
      is_admin?: boolean;
      can_submit_website?: boolean;
      authenticated?: boolean;
      [key: string]: string | number | boolean | undefined;
    }
    // interface Platform {}
    // interface Stuff {}
  }
}

export interface EntryData {
  id: number;
  favorite_count: number;
  favorited: boolean;
  github_num_followers: number;
  github_num_stars: number;
  is_user_submitted: boolean;
  name: string;
  created_at: string;
  profile_image_url: string;
  reloadKey: boolean;
  status: string;
  user_removed: boolean;
  website_url: string;
}
