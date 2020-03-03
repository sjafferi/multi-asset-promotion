<script>
  import { fade, fly } from "svelte/transition";
  import { groupBy } from "util/index.js";
  import { ENVIRONMENTS } from "stores/FormState.js";
  import Table from "components/Table.svelte";
  import Select from "components/Select.svelte";
  import Header from "components/Header.svelte";
  import Button from "components/Button.svelte";
  import Title from "components/Typography/Title.svelte";
  import Subtitle from "components/Typography/Subtitle.svelte";
  import RightChevron from "components/Icons/RightChevron.svelte";

  export let state = {};
  export let assets = [];
  export let selectedAssets = [];
  export let environment;

  let selectedItems = {},
    selectedEnv = environment,
    prevAssets,
    prevEnvironment;

  $: selectedCorrelationKey = selectedAssets.length
    ? selectedAssets[0].corrKey
    : undefined;
  $: groupedSelectedAssets = groupBy(selectedAssets, "name");
  $: groupedAssets = groupBy(
    assets.filter(({ corrKey }) => corrKey === selectedCorrelationKey) || [],
    "name"
  );

  $: {
    if (prevAssets != selectedAssets) {
      Object.keys(groupedAssets).forEach(name => {
        selectedItems[name] = groupedSelectedAssets[name]
          ? groupedSelectedAssets[name][0]
          : undefined;
      });
      prevAssets = selectedAssets;
    }
    if (prevEnvironment != environment) {
      selectedEnv = environment;
      prevEnvironment = environment;
    }
  }

  $: isNextDisabled = [...Object.values(selectedItems), selectedEnv].some(
    value => !value
  ); // at least one value unselected

  function onNext() {
    state.setEnvironment(selectedEnv.label);
    state.setSelectedAssets(Object.values(selectedItems));
    state.nextStep();
  }
</script>

<style>
  .pick-related {
    padding-bottom: 25vh;
  }

  .dropdowns {
    max-width: 75ch;
    margin: auto;
  }
</style>

<div class="pick-related">
  <Header
    title="Please select related assets"
    nextButtonText="Confirm"
    disableNext={isNextDisabled}
    nextButtonTooltip={isNextDisabled ? 'Please make selections for the remaining name groups' : undefined}
    {onNext}
    {state} />
  <div class="dropdowns">
    <Subtitle>Select environment</Subtitle>
    <Select
      options={ENVIRONMENTS.map(env => ({ label: env }))}
      placeholder="Select environment"
      bind:selectedValue={selectedEnv}
      getOptionLabel={option => option.label} />
    {#each Object.entries(groupedAssets) as [name, assets]}
      <Subtitle>Select from {name}</Subtitle>
      <Select
        options={assets}
        placeholder="Search {name}..."
        bind:selectedValue={selectedItems[name]}
        getOptionLabel={option => option.id} />
    {/each}
  </div>
</div>
