<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { EntryData } from "../app";
  import { getVisitorCountryCode } from "$lib/visitorCountry";
  import ReloadIcon from "~icons/ooui/reload";
  import ExternalLinkIcon from "~icons/octicon/link-external-16";

  export let selected: EntryData;

  const reload = () => {
    selected.reloadKey = !selected.reloadKey;
    selected = selected;
  };

  $: url = selected ? selected.website_url.replace(/\/$/, '') : "";

  const githubButtonScriptSrc = "https://buttons.github.io/buttons.js";
  const mapleDeployUrl = (utmContent: string) =>
    `https://mapledeploy.ca/?utm_source=badge&utm_medium=referral&utm_campaign=server-f1b4d852&utm_content=${utmContent}`;

  // Nothing renders in the empty state until the country lookup settles, so
  // Canadian visitors never see the GitHub prompt flash first.
  let emptyState: "pending" | "canada" | "default" = "pending";

  function loadGithubButtonScript() {
    if (document.querySelector(`script[src="${githubButtonScriptSrc}"]`)) return;

    const script = document.createElement("script");
    script.src = githubButtonScriptSrc;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  }

  onMount(async () => {
    const countryCode = await getVisitorCountryCode();
    emptyState = countryCode === "CA" ? "canada" : "default";

    if (emptyState === "default") {
      // buttons.js renders the .github-button elements present when it loads.
      await tick();
      loadGithubButtonScript();
    }
  });
</script>
<div class="w-full h-full flex flex-col p-1 bg-slate-50 md:w-full md:h-full md:z-30">
  {#if selected}
    <div class="flex items-center justify-center pt-2 pb-2 pl-7 pr-7 bg-slate-white border border-slate-300 border-b-0 rounded-tl-md rounded-tr-md">
      <button class="mr-4 text-slate-500 hover:text-slate-400" on:click={reload}>
        <ReloadIcon />
      </button>
      <a
        href={url}
        rel="noopener noreferrer"
        target="_blank"
        class="group bg-slate-200 flex-1 flex flex-row items-center rounded-full p-1 pl-5 pr-5 text-slate-550 tracking-wide text-sm hover:bg-slate-250"
      >
        {url}
        <span class="ml-1.5 text-xs hidden group-hover:inline">
          <ExternalLinkIcon />
        </span>
      </a>
    </div>
    {#key `${selected.website_url}|${selected.reloadKey}`}
      <iframe
        class="w-full flex-grow bg-white border border-slate-300 rounded-bl-md rounded-br-md"
        src={selected.website_url}
        title=""
        sandbox="allow-forms allow-modals allow-popups allow-scripts allow-same-origin allow-downloads"
      ></iframe>
    {/key}
  {:else if emptyState === "canada"}
    <div class="flex flex-grow flex-col items-center justify-center text-center px-6 -mt-8">
      <div class="max-w-md flex flex-col items-center">
        <h2 class="text-3xl font-bold mb-6 leading-tight pb-1">
          <span class="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-pink-400">
            Host your next project in Canada
          </span>
        </h2>
        <p class="text-slate-500 mb-8 leading-relaxed max-w-xs">
          Web of Devs runs on <a
            class="gradient-link"
            href={mapleDeployUrl("text-link")}
            target="_blank"
            rel="noopener">MapleDeploy</a>: managed Coolify hosting on servers in Toronto.
          Git push deploys and managed databases, with your data kept in Canada.
        </p>
        <a class="inline-block leading-none" href={mapleDeployUrl("html-light-large")} target="_blank" rel="noopener">
          <img
            class="block"
            src="https://mapledeploy.ca/api/badge?theme=light&size=large"
            srcset="https://mapledeploy.ca/api/badge?theme=light&size=large&scale=2 2x"
            alt="Hosted in Canada with MapleDeploy"
          />
        </a>
      </div>
    </div>
  {:else if emptyState === "default"}
    <div class="flex flex-grow flex-col items-center justify-center text-center px-6 -mt-8">
      <div class="max-w-md flex flex-col items-center">
        <h2 class="text-3xl font-bold mb-6 leading-tight pb-1">
          <span class="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-pink-400">
            Web of Devs is now open source!
          </span>
        </h2>
        <p class="text-slate-500 mb-8 leading-relaxed max-w-xs">
          If it's helped you discover great developers, a star on GitHub goes a long way.
        </p>
        <a
          class="github-button"
          href="https://github.com/rosslh/webofdevs.com"
          data-color-scheme="no-preference: light; light: light; dark: light;"
          data-icon="octicon-star"
          data-size="large"
          data-show-count="true"
          aria-label="Star rosslh/webofdevs.com on GitHub"
        >
          Star on GitHub
        </a>
      </div>
    </div>
  {/if}
</div>
