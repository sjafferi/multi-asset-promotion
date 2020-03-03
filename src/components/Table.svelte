<script>
  import { onMount } from "svelte";
  import { capitalize } from "util/index.js";
  export let rows = [];
  export let onRowSelected;
  export let onUnselect;
  export let selectedRows = [];

  $: columns =
    rows.length > 0
      ? Object.entries(rows[0]).map(([key], index) => ({
          field: key,
          headerName: capitalize(key),
          sortable: true,
          checkboxSelection: index == 0
        }))
      : [];

  let gridOptions = {};

  onMount(() => {
    document.addEventListener("DOMContentLoaded", () => {
      gridOptions = {
        columnDefs: columns,
        rowData: rows,
        rowSelection: "multiple",
        rowMultiSelectWithClick: true,
        pagination: true,
        // animateRows: true,
        defaultColDef: {
          filter: true
        },
        onRowSelected: event => {
          if (onRowSelected && event.node.selected) {
            onRowSelected(gridOptions, event.node.data);
          }
        },
        onSelectionChanged: event => {
          const rowCount = event.api.getSelectedNodes().length;
          if (rowCount == 0) {
            gridOptions.api.setFilterModel(null);
            if (onUnselect) {
              onUnselect();
            }
          }
          selectedRows = event.api.getSelectedNodes();
        }
      };
      const gridDiv = document.querySelector("#table-container");
      new agGrid.Grid(gridDiv, gridOptions);
    });
  });

  $: {
    if (gridOptions && gridOptions.api) {
      gridOptions.api.setColumnDefs(columns);
      gridOptions.api.setRowData(rows);
    }
  }
</script>

<style>
  .table-container {
    max-width: 815px;
    height: 70vh;
    margin: 0 auto;
    overflow-x: hidden;
  }
  :global(.ag-root) {
    border: none !important;
  }
  :global(.ag-header) {
    border-radius: 1.1em;
    margin-bottom: 10px;
    height: 38px;
  }
  :global(.ag-center-cols-container::-webkit-scrollbar-thumb) {
    border-radius: 10px;
    box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.3);
    background-color: #888;
  }
  :global(.ag-center-cols-container::-webkit-scrollbar) {
    width: 5px;
    background-color: transparent;
    box-shadow: none;
  }

  @media screen and (max-width: 550px) {
    .table-container {
      width: 85vw;
      max-width: 825px;
    }
  }
</style>

<div id="table-container" class="table-container ag-theme-balham" />
