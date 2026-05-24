<script lang="ts">
  import { tick } from "svelte";
  import shuffle from "lodash/shuffle";

  import EntrySortFilter from "../components/EntrySortFilter.svelte";
  import EntryList from "../components/EntryList.svelte";
  import WebsiteFrame from "../components/WebsiteFrame.svelte";
  import AddSiteButton from "../components/AddSiteButton.svelte";
  import AddSiteModal from "../components/AddSiteModal.svelte";
  import ReportSiteModal from "../components/ReportSiteModal.svelte";
  import RemoveSiteModal from "../components/RemoveSiteModal.svelte";
  import type { EntryData } from "../app";

  export let data;

  type SortField =
    | "favorite_count"
    | "github_num_followers"
    | "github_num_stars"
    | "name"
    | "created_at";

  type SortDirection = "asc" | "desc";

  $: entries = data.entries;
  $: programmingLanguages = data.programmingLanguages;
  $: is_admin = data.is_admin;
  $: authenticated = data.authenticated;
  $: can_submit_website = data.can_submit_website;
  $: website_url = data.website_url;
  $: user_id = data.user_id;

  let selected = null;

  $: shuffledEntries = is_admin
    ? entries.some((e) => e.status === "requires_review")
      ? shuffle(entries.filter((e) => e.status === "requires_review"))
      : shuffle(entries)
    : shuffle(entries);

  let currentShuffledIndex = 0;

  const getRandomEntry = async () => {
    if (shuffledEntries.length === 0) {
      return;
    }

    selected = shuffledEntries[currentShuffledIndex % shuffledEntries.length];
    currentShuffledIndex += 1;
    await tick();
    document
      .querySelector("[data-selected]")
      ?.scrollIntoView({ behavior: "smooth", block: "start", inline: "start" });
  };

  let sortBy: SortField = "favorite_count";
  let sortDirection: SortDirection = "desc";
  let selectedLanguage = null;
  let onlyShowMyFavorites = false;

  const getSortValue = (entry: EntryData, field: SortField) => {
    const value = entry[field];

    if (value === null || value === undefined) {
      return null;
    }

    return typeof value === "string" ? value.toLocaleLowerCase() : value;
  };

  const compareByNameAndId = (a: EntryData, b: EntryData) =>
    a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: "base",
    }) || a.id - b.id;

  const compareEntries = (
    a: EntryData,
    b: EntryData,
    field: SortField,
    direction: SortDirection
  ) => {
    const aValue = getSortValue(a, field);
    const bValue = getSortValue(b, field);

    if (aValue === null && bValue === null) {
      return compareByNameAndId(a, b);
    }

    if (aValue === null) {
      return 1;
    }

    if (bValue === null) {
      return -1;
    }

    const primaryComparison =
      typeof aValue === "number" && typeof bValue === "number"
        ? aValue - bValue
        : String(aValue).localeCompare(String(bValue), undefined, {
            numeric: true,
            sensitivity: "base",
          });

    if (primaryComparison !== 0) {
      return direction === "desc" ? -primaryComparison : primaryComparison;
    }

    return compareByNameAndId(a, b);
  };

  $: sortedEntries = entries
    .filter((entry) => !onlyShowMyFavorites || entry.favorited)
    .sort((a, b) => compareEntries(a, b, sortBy, sortDirection));

  const updateEntry = (updatedEntry: EntryData) => {
    entries = entries.map((entry) =>
      entry.id === updatedEntry.id ? updatedEntry : entry
    );

    if (selected?.id === updatedEntry.id) {
      selected = updatedEntry;
    }
  };

  const getFilteredEntries = async (filterByLanguage: number) => {
    if (filterByLanguage) {
      entries = await fetch(
        `/api/entries?programmingLanguageId=${filterByLanguage}`
      ).then((res) => res.json());
    } else {
      entries = await fetch("/api/entries").then((res) => res.json());
    }
    currentShuffledIndex = 0;
  };

  let handledLanguage = null;
  $: {
    if (selectedLanguage !== handledLanguage) {
      handledLanguage = selectedLanguage;
      getFilteredEntries(selectedLanguage);
    }
  }

  let showAddSiteModal = false;
  let showReportSiteModalForEntry = null;
  let showRemoveSiteModal = false;

  const submitWebsite = async (website: string) => {
    const submitWebsiteRequest = fetch("/api/entries", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        website,
      }),
    });

    const updateSessionRequest = fetch(`/session?update=submitted_website`, {
      method: "PUT",
    });

    await Promise.all([submitWebsiteRequest, updateSessionRequest]);

    setTimeout(() => window.location.reload(), 8000);
  };

  const reportWebsite = async (websiteId: number, reason: string) => {
    await fetch(`/api/reports/${websiteId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        reason,
      }),
    });
  };

  const removeWebsite = async () => {
    const deleteWebsiteRequest = fetch(`/api/entries/${user_id}`, {
      method: "DELETE",
    });

    const updateSessionRequest = fetch(`/session?update=removed_website`, {
      method: "PUT",
    });

    await Promise.all([deleteWebsiteRequest, updateSessionRequest]);

    setTimeout(() => window.location.reload(), 8000);
  };
</script>

<div class="flex flex-row h-full md:flex-col">
  {#if showAddSiteModal}
    <AddSiteModal
      {submitWebsite}
      detectedWebsiteUrl={website_url}
      bind:showAddSiteModal
    />
  {/if}
  {#if showReportSiteModalForEntry}
    <ReportSiteModal {reportWebsite} bind:showReportSiteModalForEntry />
  {/if}
  {#if showRemoveSiteModal}
    <RemoveSiteModal {removeWebsite} bind:showRemoveSiteModal />
  {/if}
  <div
    class="w-80 shrink-0 border-r border-slate-200 flex flex-col md:w-full md:flex-row"
  >
    <EntrySortFilter
      {authenticated}
      {programmingLanguages}
      {getRandomEntry}
      bind:selectedLanguage
      bind:sortBy
      bind:sortDirection
      bind:onlyShowMyFavorites
    />
    <EntryList
      bind:selected
      bind:showReportSiteModalForEntry
      bind:showRemoveSiteModal
      {sortedEntries}
      {is_admin}
      {authenticated}
      {sortBy}
      {user_id}
      {updateEntry}
    />
    {#if authenticated && can_submit_website}
      <AddSiteButton bind:showAddSiteModal />
    {/if}
  </div>
  <WebsiteFrame bind:selected />
</div>
