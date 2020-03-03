<script>
  import Select from "svelte-select";
  export let options = [];
  export let placeholder = "Search...";
  export let selectedValue = undefined;
  export let getOptionLabel = option => Object.values(option).join(" / ");
</script>

<Select
  {getOptionLabel}
  {placeholder}
  items={options}
  getSelectionLabel={getOptionLabel}
  bind:selectedValue />
