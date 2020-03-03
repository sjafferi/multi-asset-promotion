<script>
  import { onMount, onDestroy } from "svelte";
  import { NotificationDisplay, notifier } from "@beyonk/svelte-notifications";
  import { formState, FORM_STEPS } from "stores/FormState.js";
  import { capitalize } from "util/index.js";
  import Promote from "routes/Promote.svelte";
  import PickRelated from "routes/PickRelated.svelte";
  import Confirm from "routes/Confirm.svelte";

  // Used for SSR. A falsy value is ignored by the Router.
  export let url = "";

  let isLoading = false;
  let translateX = 0;
  const store = {
    assets: [],
    currentStep: 0,
    selectedAssets: [],
    environment: null
  };

  onMount(() => {
    formState.subscribe((field, value) => {
      store[field] = value;
      if (field === "currentStep") {
        updateStep();
      }
    });
  });

  onDestroy(() => formState.unsubscribe());

  function updateStep() {
    translateX = -1 * store.currentStep * window.innerWidth;
  }

  function postPromotedAssets(assets) {
    return new Promise(resolve => {
      setTimeout(() => resolve({ statusCode: 200 }), 1500);
    });
  }

  async function onSubmit(environment, assets) {
    isLoading = true;
    const payload = assets.map(asset => ({ ...asset, env: environment }));
    // send mock call
    const response = await postPromotedAssets(payload);
    isLoading = false;
    if (response.statusCode === 200) {
      formState.setAssets(
        store.assets.map(asset =>
          assets.includes(asset) ? { ...asset, env: environment } : asset
        )
      );
      formState.reset();
      notifier.success("Promotion successful!");
    }
  }

  function formatTitle(title) {
    return capitalize(title.replace("-", " "));
  }
</script>

<style>
  :global(#app) {
    overflow: hidden;
  }

  :global(#app.dark) {
    width: 100vw;
    height: 100vh;
    background: #2d3436;
  }

  .container {
    width: 100vw;
    display: flex;
    transition: transform 500ms cubic-bezier(0.23, 1, 0.32, 1) 0s;
  }

  .page {
    min-width: 100vw;
    padding: 0 20px;
  }
</style>

<svelte:window on:resize={updateStep} />

<svelte:head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>
    {`Step ${store.currentStep + 1}/${FORM_STEPS.length} ${formatTitle(FORM_STEPS[store.currentStep])} | Multi-Asset Promotion`}
  </title>
</svelte:head>

<div class="container" style={`transform: translate3d(${translateX}px, 0, 0);`}>
  <div class="page">
    <Promote state={formState} assets={store.assets} />
  </div>
  <div class="page">
    <PickRelated state={formState} {...store} />
  </div>
  <div class="page">
    <Confirm state={formState} {...store} {onSubmit} isSaving={isLoading} />
  </div>
</div>

<NotificationDisplay />
