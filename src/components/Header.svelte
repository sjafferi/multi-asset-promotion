<script>
  import { fade, fly } from "svelte/transition";
  import Title from "components/Typography/Title.svelte";
  import Table from "components/Table.svelte";
  import RightChevron from "components/Icons/RightChevron.svelte";
  import Button from "components/Button.svelte";

  export let state = {};
  export let title;
  export let onNext;
  export let onBack;
  export let disableNext;
  export let showBack = true;
  export let showNext = true;
  export let nextButtonText = "";
  export let nextButtonTooltip = "";

  $: next =
    onNext ||
    (() => {
      state.nextStep();
    });

  $: back =
    onBack ||
    (() => {
      state.previousStep();
    });
</script>

<style>
  .header {
    position: relative;
    margin-top: 3%;
  }

  .buttons {
    width: 100%;
    top: -25px;
    right: 30px;
    display: flex;
    position: absolute;
    justify-content: space-between;
    padding-left: 3.25%;
    opacity: 1;
    color: #333;
  }

  :global(.buttons svg) {
    fill: #333;
    margin-left: 5px;
    transform: translateX(0px);
    transition: transform 200ms linear;
  }

  :global(.buttons div.button:hover svg) {
    transform: translateX(6px);
    fill: #888;
  }

  :global(.buttons button.disabled svg) {
    transform: none !important;
  }

  :global(.icon.reverse svg) {
    transform: rotate(180deg);
    margin: 0;
    margin-right: 5px;
  }

  :global(.buttons .button.back:hover svg) {
    transform: translateX(-6px) rotate(180deg) !important;
  }

  @media (max-width: 550px) {
    :global(.header h1) {
      margin-top: 10vh;
    }
    .buttons {
      top: -8vh;
      right: 0px;
      width: 90vw;
      margin: auto;
      padding: 0;
    }
  }
</style>

<div class="header">
  <Title>{title}</Title>
  <div class="buttons">
    {#if showBack}
      <div class="button back" in:fade out:fade>
        <Button onClick={back}>
          <span class="icon reverse">
            <RightChevron />
          </span>
          Back
        </Button>
      </div>
    {/if}
    {#if showNext}
      <div class="button" in:fade out:fade>
        <Button
          onClick={next}
          disabled={disableNext}
          tooltip={nextButtonTooltip}>
          {nextButtonText}
          <RightChevron />
        </Button>
      </div>
    {/if}
  </div>
</div>
