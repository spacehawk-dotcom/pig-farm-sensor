// Hardware inching remains enabled. Initial adjustment range never exceeds
// the commissioned 5-second up / 6-second down movement.
function validTiming(value) {
  return !!value && Number.isInteger(value.upSeconds) && value.upSeconds >= 1 && value.upSeconds <= 5 &&
    Number.isInteger(value.downSeconds) && value.downSeconds >= 1 && value.downSeconds <= 6 &&
    Number.isSafeInteger(value.revision) && value.revision >= 0;
}
function timerFor(cfg, timing) {
  const bytes = Buffer.from(cfg.safety.switch_inching, 'base64');
  for (let i=0;i<bytes.length;i+=3) {
    const channel='switch_'+((bytes[i]>>1)+1);
    const seconds=channel===cfg.upChannel?timing.upSeconds:channel===cfg.downChannel?timing.downSeconds:null;
    if(seconds!==null){bytes[i]|=1;bytes.writeUInt16BE(seconds,i+1);}
  }
  return bytes.toString('base64');
}
module.exports={validTiming,timerFor};
