<script lang="ts">
  import type { EntryData } from "../app";

  export let sortedEntries: EntryData[];
  export let selected: EntryData;
  export let user_id: number;
  export let is_admin: boolean;
  export let authenticated: boolean;
  export let sortBy: string;
  export let updateEntry: (entry: EntryData) => void;

  export let showReportSiteModalForEntry: number;
  export let showRemoveSiteModal: boolean;

  import Entry from "./entry.svelte";
</script>
<div class="overflow-y-auto h-full md:overflow-y-hidden md:overflow-x-scroll md:h-12 md:flex md:flex-row">
  {#each sortedEntries as entry (entry.id)}
    <Entry
      {entry}
      {updateEntry}
      bind:selected={selected}
      bind:showReportSiteModalForEntry={showReportSiteModalForEntry}
      bind:showRemoveSiteModal={showRemoveSiteModal}
      showFollowers={sortBy === "github_num_followers"}
      showStars={sortBy === "github_num_stars"}
      {authenticated}
      {is_admin}
      {user_id}
    />
  {/each}
</div>
