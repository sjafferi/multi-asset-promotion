<script>
  import Header from "components/Header.svelte";
  import Button from "components/Button.svelte";
  import Subtitle from "components/Typography/Subtitle.svelte";

  export let environment;
  export let selectedAssets = [];
  export let state = {};
  export let isSaving = false;
  export let onSubmit = () => {};
</script>

<style>
  .content {
    max-width: 75ch;
    margin: auto;
  }

  .buttons {
    display: flex;
    justify-content: center;
  }

  .summary {
    display: flex;
    flex-flow: column;
    justify-content: center;
    padding: 25px 0;
  }

  :global(.summary h2) {
    font-weight: 300;
  }

  @media (min-width: 550px) {
    .summary {
      margin-left: 25%;
    }
  }

  .buttons span {
    margin-left: 15px;
  }

  span.cross {
    text-decoration: line-through;
  }
</style>

<div class="confirm">
  <Header title="Confirm your changes" showNext={false} {state} />
  <div class="content">
    <div class="summary">
      {#each selectedAssets as { name, id, env }}
        <Subtitle>
          {name} {id}:
          <span class="cross">{env}</span>
          {environment}
        </Subtitle>
      {/each}
    </div>
    <div class="buttons">
      <span class="cancel">
        <Button outline={true} onClick={() => state.reset()}>Cancel</Button>
      </span>
      <span class="submit">
        <Button
          outline={true}
          onClick={() => onSubmit(environment, selectedAssets)}>
          {isSaving ? 'Saving...' : 'Submit'}
        </Button>
      </span>
    </div>
  </div>
</div>
