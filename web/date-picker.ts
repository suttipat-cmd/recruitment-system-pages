import flatpickr from 'flatpickr';
import {Thai} from 'flatpickr/dist/l10n/th.js';
import 'flatpickr/dist/flatpickr.css';
import {parseCalendarDate} from './domain';

export function installDatePickers() {
  const active = new Map<HTMLInputElement, ReturnType<typeof flatpickr>>();
  function sync() {
    for(const [input,picker] of active) if(!input.isConnected) {
      if(!Array.isArray(picker)) picker.destroy();
      active.delete(input);
    }
    document.querySelectorAll<HTMLInputElement>('input[data-date]').forEach(input=>{
      if(active.has(input)) return;
      input.addEventListener('input',()=>{
        if(/^\d{8}$/.test(input.value)) input.value=input.value.slice(0,2)+'/'+input.value.slice(2,4)+'/'+input.value.slice(4);
        input.setCustomValidity(input.value && !parseCalendarDate(input.value) ? 'วันที่ไม่ถูกต้อง กรุณากรอก dd/mm/yyyy (ค.ศ.)' : '');
      });
      input.addEventListener('change',()=>input.setCustomValidity(input.value && !parseCalendarDate(input.value) ? 'วันที่ไม่ถูกต้อง กรุณากรอก dd/mm/yyyy (ค.ศ.)' : ''));
      // Flatpickr clears an invalid manually typed value on blur. Preserve it
      // so optional date fields cannot silently turn an invalid filter into no filter.
      input.addEventListener('blur',()=>{
        const value=input.value;
        if(value && !parseCalendarDate(value)) queueMicrotask(()=>{
          if(!input.isConnected)return;
          input.value=value;
          input.setCustomValidity('วันที่ไม่ถูกต้อง กรุณากรอก dd/mm/yyyy (ค.ศ.)');
        });
      },true);
      input.pattern='[0-9]{2}/[0-9]{2}/[0-9]{4}';
      input.title='เลือกจากปฏิทิน หรือพิมพ์ dd/mm/yyyy (ค.ศ.)';
      const picker=flatpickr(input,{
        locale:Thai, dateFormat:'d/m/Y', ariaDateFormat:'j F Y',
        allowInput:true, disableMobile:true, monthSelectorType:'dropdown',
        appendTo:input.closest<HTMLDialogElement>('dialog') || undefined,
        position:(instance)=>{
          const box=input.getBoundingClientRect();
          const calendar=instance.calendarContainer;
          const height=calendar.offsetHeight || 310;
          const width=calendar.offsetWidth || 308;
          calendar.style.position='fixed';
          calendar.style.left=Math.max(8,Math.min(box.left,window.innerWidth-width-8))+'px';
          const viewportTop=window.visualViewport?.offsetTop || 0;
          const viewportBottom=viewportTop+(window.visualViewport?.height || window.innerHeight);
          calendar.style.top=Math.max(viewportTop+8,Math.min(box.bottom+height>viewportBottom ? box.top-height-6 : box.bottom+6,viewportBottom-height-8))+'px';
          calendar.style.right='auto';
        },
        parseDate:(value)=>parseCalendarDate(value) as Date,
        errorHandler:()=>{},
        onReady:(_dates,_value,instance)=>{
          instance.calendarContainer.setAttribute('aria-label','ปฏิทินเลือกวันที่ (ค.ศ.)');
          instance.currentYearElement.setAttribute('aria-label','ปี ค.ศ.');
        },
      });
      active.set(input,picker);
    });
  }
  new MutationObserver(sync).observe(document.body,{childList:true,subtree:true});
  function reposition() {
    for(const picker of active.values()) if(!Array.isArray(picker) && picker.isOpen && typeof picker.config.position==='function') picker.config.position(picker,undefined);
  }
  document.addEventListener('scroll',reposition,true);
  window.visualViewport?.addEventListener('resize',reposition);
  window.visualViewport?.addEventListener('scroll',reposition);
  sync();
}
