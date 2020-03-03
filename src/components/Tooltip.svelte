<script>
  export let text;
</script>

<style>
  .tooltip {
    position: relative;
    display: inline-block;
  }

  .tooltip .text {
    visibility: hidden;
    width: 120px;
    background-color: black;
    color: #fff;
    text-align: center;
    border-radius: 6px;
    padding: 5px 0;
    position: absolute;
    top: 150%;
    left: -15px;
    z-index: 1;
  }

  .tooltip:hover .text {
    visibility: visible;
  }
</style>

<div class="tooltip">
  <slot />
  <span class="text">{text}</span>
</div>
