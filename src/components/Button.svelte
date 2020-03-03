<script>
  import Tooltip from "components/Tooltip.svelte";
  export let onClick = () => {};
  export let disabled;
  export let tooltip;

  export let outline;
</script>

<style>
  button {
    margin: 0;
    color: #333;
    padding: 0.5em;
    font-size: 1.05em;
    border-radius: 3px;
    border-color: transparent;
    text-decoration: none;
    outline: none !important;
    background: none;
  }

  button:hover {
    color: #888;
    cursor: pointer;
  }

  .outline {
    border-width: 1px;
    border-style: solid;
    border-color: transparent;
    transition: box-shadow 200ms ease 0s, background-color 200ms ease 0s;
    border: 1px solid #333;
    padding: 5px 20px;
    background: white;
    box-shadow: rgba(107, 107, 107, 0.15) 1px 2px 5px 0px;
  }

  .outline:hover {
    color: white;
    background: #333;
    box-shadow: rgba(107, 107, 107, 0.35) 1px 2px 5px 0px;
  }

  .disabled {
    cursor: not-allowed !important;
  }
</style>

{#if tooltip}
  <Tooltip text={tooltip}>
    <button
      {...$$props}
      on:click={onClick}
      class:disabled
      class:outline
      {disabled}>
      <slot />
    </button>
  </Tooltip>
{:else}
  <button
    {...$$props}
    on:click={onClick}
    class:disabled
    class:outline
    {disabled}>
    <slot />
  </button>
{/if}
