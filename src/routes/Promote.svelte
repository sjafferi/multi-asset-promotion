<script>
  import { onMount } from "svelte";
  import { fade, fly } from "svelte/transition";
  import Title from "components/Typography/Title.svelte";
  import Table from "components/Table.svelte";
  import Button from "components/Button.svelte";
  import Header from "components/Header.svelte";
  import RightChevron from "components/Icons/RightChevron.svelte";

  export let state = {};
  export let assets = [];

  let selectedRows = [];
  let showActivate = false;

  onMount(() => {
    fetch(`/get-assets`, {
      method: "get",
      headers: {
        "Content-Type": "application/json"
      }
    })
      .then(resp => resp.json())
      .then(response => {
        state.setAssets(response);
      });
  });

  function filterByCorr(gridOptions, { corrKey, name }) {
    showActivate = true;
    gridOptions.api.setFilterModel({
      corrKey: {
        type: "contains",
        filter: corrKey
      }
    });
  }

  function onNext() {
    state.setSelectedAssets(selectedRows.map(({ data }) => data));
    state.nextStep();
  }
</script>

<style>
  :global(.promote .button) {
    margin-left: auto;
  }
  :global(#table-container) {
    margin: auto;
    margin-top: 5%;
  }
</style>

<div class="promote">
  <Header
    title="Please select assets to promote"
    nextButtonText="Promote"
    showBack={false}
    showNext={showActivate}
    {state}
    {onNext} />
  <Table
    rows={assets}
    onRowSelected={filterByCorr}
    onUnselect={() => (showActivate = false)}
    bind:selectedRows />
</div>
