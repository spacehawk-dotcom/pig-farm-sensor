(() => {
  const DAY = 86400000;
  const dateKey = date => date.toISOString().slice(0, 10);
  function monday(date) {
    const day = new Date(date + 'T00:00:00Z');
    day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
    return dateKey(day);
  }
  function currentMonday(now = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(now).map(part => [part.type, part.value]));
    return monday(`${parts.year}-${parts.month}-${parts.day}`);
  }
  const stages = {
    early: {label:'임신 초기', card:'bg-blue-50 border-blue-200', stripe:'bg-blue-400', text:'text-blue-700'},
    middle: {label:'유지·체형 조절', card:'bg-emerald-50 border-emerald-200', stripe:'bg-emerald-400', text:'text-emerald-700'},
    late: {label:'태아 성장기', card:'bg-orange-50 border-orange-200', stripe:'bg-orange-400', text:'text-orange-700'}
  };
  function classify(farrowingWeek, referenceMonday) {
    // The expected week's Thursday represents the group; mating is 115 days earlier.
    // Calendar arithmetic uses UTC days so browser timezone/DST cannot shift the week.
    const representativeDays = (Date.parse(monday(referenceMonday)) - Date.parse(monday(farrowingWeek))) / DAY + 115 - 3;
    const stage = representativeDays <= 30 ? 'early' : representativeDays < 90 ? 'middle' : 'late';
    return {stage, ...stages[stage]};
  }
  window.FarmGestationWeek = {currentMonday, classify};
})();
