import { AllCommunityModule, ModuleRegistry, createGrid, themeQuartz, type GridApi, type ColDef } from 'ag-grid-community';

ModuleRegistry.registerModules([AllCommunityModule]);
let grid: GridApi | undefined;

export function destroyApplicantGrid() {
  grid?.destroy();
  grid = undefined;
}

// The server remains responsible for sorting, filtering and pagination. The
// existing table is the source for cell markup and remains a safe fallback.
export function mountApplicantGrid(root: HTMLElement) {
  const table = root.querySelector<HTMLTableElement>('.applicant-desktop table.applicant-table');
  if (!table || !table.tHead?.rows[0] || !table.tBodies[0]?.rows.length) return;
  const headings = Array.from(table.tHead.rows[0].cells);
  const rows = Array.from(table.tBodies[0].rows, row => Array.from(row.cells, cell => cell.innerHTML));
  const host = document.createElement('div');
  host.className = 'applicant-grid';
  host.setAttribute('aria-label', 'ตารางรายการผู้สมัคร');
  table.before(host);
  const columns: ColDef<string[]>[] = headings.map((header, index) => ({
    headerName: header.textContent?.trim() || 'จัดการ',
    colId: String(index),
    minWidth: index === 0 ? 72 : index === 1 ? 220 : index === 2 || index === 3 ? 220 : index === headings.length - 1 ? 130 : 150,
    width: index === 0 ? 72 : index === 1 ? 240 : index === 2 || index === 3 ? 240 : index === headings.length - 1 ? 130 : 160,
    pinned: index < 2 ? 'left' : index === headings.length - 1 ? 'right' : undefined,
    lockPinned: true,
    sortable: false,
    valueGetter: params => params.data?.[index] ?? '',
    cellRenderer: (params: {value: string}) => {
      const element = document.createElement('div');
      element.className = 'grid-cell-content';
      element.innerHTML = params.value || '';
      element.title = Array.from(element.childNodes, node => node.textContent?.trim()).filter(Boolean).join(' · ');
      return element;
    },
    headerComponent: class {
      private element = document.createElement('div');
      init() {
        this.element.className = 'grid-header-content';
        this.element.innerHTML = header.innerHTML;
      }
      getGui() { return this.element; }
    },
  }));
  try {
    grid = createGrid(host, {
      theme: themeQuartz.withParams({accentColor:'#087a67', foregroundColor:'#263d48', backgroundColor:'#ffffff', headerBackgroundColor:'#f6f9f8', borderColor:'#dce8e4', fontFamily:'inherit', fontSize:13, rowHeight:44, headerHeight:44}),
      columnDefs: columns,
      rowData: rows,
      domLayout: 'autoHeight',
      ensureDomOrder: true,
      suppressCellFocus: false,
      defaultColDef: {resizable:true},
    });
    table.hidden = true;
  } catch (error) {
    host.remove();
    console.error('ไม่สามารถแสดงตารางได้ ใช้ตารางสำรอง', error);
  }
}
