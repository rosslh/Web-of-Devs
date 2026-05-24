<script lang="ts">
  import type { EntryData } from "../app";

  export let entry: EntryData;
  export let selected: EntryData;
  export let user_id: number;
  export let is_admin: boolean;
  export let authenticated: boolean;
  export let showFollowers: boolean;
  export let showStars: boolean;
  export let showReportSiteModalForEntry: number;
  export let showRemoveSiteModal: boolean;
  export let updateEntry: (entry: EntryData) => void = () => {};

  import ThumbsUpIcon from "~icons/fa/thumbs-up";
  import ThumbsDownIcon from "~icons/fa/thumbs-down";
  import HeartFilledIcon from "~icons/octicon/heart-fill-16";
  import HeartOutlineIcon from "~icons/octicon/heart-16";
  import StarIcon from "~icons/octicon/star-16";
  import FollowersIcon from "~icons/octicon/people-16";
  import InfoIcon from "~icons/octicon/info-16";
  import RemoveIcon from "~icons/octicon/trash-16";
  import ReportIcon from "~icons/ci/flag-fill";

  const applyEntryUpdate = (changes: Partial<EntryData>) => {
    const updatedEntry = { ...entry, ...changes };
    entry = updatedEntry;
    updateEntry(updatedEntry);
    return updatedEntry;
  };

  async function review(status: string) {
    applyEntryUpdate({ status });
    await fetch(`/api/reviews/${entry.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status }),
    });
  }

  const approve = async () => {
    await review("approved");
  };

  const reject = async () => {
    await review("rejected");
  };

  const favorite = async () => {
    applyEntryUpdate({
      favorited: true,
      favorite_count: entry.favorite_count + 1,
    });
    await fetch(`/api/favorites`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: entry.id }),
    });
  };

  const unfavorite = async () => {
    applyEntryUpdate({
      favorited: false,
      favorite_count: Math.max(0, entry.favorite_count - 1),
    });
    await fetch(`/api/favorites/${entry.id}`, {
      method: "DELETE",
    });
  };

  $: domainName = entry.website_url
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");

  const setSelected = () => {
    const updatedEntry = applyEntryUpdate({ reloadKey: !entry.reloadKey });
    selected = updatedEntry;
  };
</script>

<div
  class="entry group text-slate-800 text-sm bg-slate-50 border-b border-slate-200 border-l-4 border-l-transparent flex flex-row items-center p-2 pl-1 cursor-pointer hover:bg-slate-100 md:flex-shrink-0 md:border-r md:border-r-slate-200"
  class:selected={selected?.id === entry.id}
  data-selected={selected?.id === entry.id || null}
  on:click={setSelected}
  on:keydown={(e) => {
    if (["Enter", " "].includes(e.key)) {
      selected = entry;
      e.preventDefault();
    }
  }}
  tabindex="0"
  role="button"
>
  <img
    class="md:w-9 md:h-9 w-10 h-10 mr-2.5 border border-slate-200 rounded-full"
    src={entry.profile_image_url}
    loading="lazy"
    alt=""
  />
  <div class="flex flex-col">
    <span class="text-slate-700">
      {entry.name}
    </span>
    <span class="entry-subtitle text-slate-500 flex mt-0.5">
      {domainName}
    </span>
    {#if is_admin && entry.is_user_submitted}
      <span class="entry-subtitle flex mt-0.5 text-orange-500 font-medium">
        <InfoIcon /> User Submission
      </span>
    {/if}
    {#if showFollowers}
      <span class="entry-subtitle text-slate-500 flex mt-0.5 md:hidden ">
        <FollowersIcon />
        {entry.github_num_followers.toLocaleString()} follower{entry.github_num_followers ===
        1
          ? ""
          : "s"}
      </span>
    {/if}
    {#if showStars}
      <span class="entry-subtitle text-slate-500 flex mt-0.5 md:hidden">
        <StarIcon />
        {entry.github_num_stars.toLocaleString()} star{entry.github_num_stars ===
        1
          ? ""
          : "s"}
      </span>
    {/if}
  </div>
  <div
    class="entry-actions flex flex-row justify-end flex-grow space-x-1 pr-2 pl-1 md:pr-1"
  >
    {#if authenticated}
      {#if entry.id === user_id}
        <button
          class="hidden group-hover:inline"
          on:click={() => {
            showRemoveSiteModal = true;
          }}
        >
          <RemoveIcon />
        </button>
      {:else if !is_admin}
        <button
          class="hidden group-hover:inline"
          on:click={() => {
            showReportSiteModalForEntry = entry.id;
          }}
        >
          <ReportIcon />
        </button>
      {/if}
    {/if}
    <button
      on:click|stopPropagation={entry.favorited ? unfavorite : favorite}
      class="favorite flex"
      class:active={entry.favorited}
      disabled={!authenticated || entry.id === user_id}
      title={!authenticated ? "Sign in to favorite websites" : undefined}
    >
      <span>
        {#if entry.favorited}
          <HeartFilledIcon />
        {:else}
          <HeartOutlineIcon />
        {/if}
      </span>
      <span>{entry.favorite_count.toLocaleString()}</span>
    </button>
    {#if is_admin}
      {#if entry.status !== "approved"}
        <button
          on:click|stopPropagation={approve}
          class="approve flex md:hidden"
        >
          <ThumbsUpIcon />
        </button>
      {/if}
      {#if entry.status !== "rejected"}
        <button on:click|stopPropagation={reject} class="reject flex md:hidden">
          <ThumbsDownIcon />
        </button>
      {/if}
    {/if}
  </div>
</div>

<style lang="postcss">
  .entry {
    min-width: 15rem;
  }

  .entry.selected {
    background-image: linear-gradient(theme('colors.slate.100'), theme('colors.slate.100')),
                      linear-gradient(to bottom, theme('colors.indigo.400'), theme('colors.pink.400'));
    background-origin: border-box;
    background-clip: padding-box, border-box;
  }

  .entry-subtitle {
    @apply text-xs items-center;
  }

  .entry-subtitle > :global(svg) {
    @apply mr-1;
  }

  .entry-actions button {
    @apply p-2 text-slate-500 cursor-pointer flex-row justify-center items-center space-x-1;
  }

  .entry-actions button > span :global(svg) {
    overflow: visible !important;
  }

  .entry-actions .favorite.active {
    @apply text-pink-500;
  }

  .entry-actions button:not(:disabled):hover {
    @apply opacity-70;
  }
</style>
