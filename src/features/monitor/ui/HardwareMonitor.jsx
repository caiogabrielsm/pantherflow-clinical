export default function HardwareMonitor({ sysHealth }) {
  return (
    <div className="w-full bg-white flex flex-col">
      <div className="px-6 py-3 border-b border-slate-200">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Carga do Sistema</p>
      </div>

      <div className="px-6 py-6 flex flex-col gap-8">

        {/* RAM */}
        <div>
          <div className="flex justify-between text-xs mb-2">
            <span className="font-bold text-slate-400 uppercase tracking-widest">Memória RAM</span>
            <span className="font-mono font-semibold text-slate-700">
              {sysHealth ? sysHealth.ram.label : '—'}
            </span>
          </div>
          <div className="w-full bg-slate-100 h-2">
            <div
              className="bg-slate-700 h-2 transition-all duration-500"
              style={{ width: `${sysHealth ? sysHealth.ram.percent : 0}%` }}
            />
          </div>
        </div>

        {/* CPU */}
        <div>
          <div className="flex justify-between text-xs mb-2">
            <span className="font-bold text-slate-400 uppercase tracking-widest">
              CPU {sysHealth?.cpu?.threads ? `(${sysHealth.cpu.threads} threads)` : ''}
            </span>
            <span className="font-mono font-semibold text-slate-700">
              {sysHealth ? `${sysHealth.cpu.percent}%` : '—'}
            </span>
          </div>
          <div className="w-full bg-slate-100 h-2">
            <div
              className="bg-emerald-600 h-2 transition-all duration-500"
              style={{ width: `${sysHealth ? sysHealth.cpu.percent : 0}%` }}
            />
          </div>
        </div>

        {/* Disco */}
        <div>
          <div className="flex justify-between text-xs mb-2">
            <span className="font-bold text-slate-400 uppercase tracking-widest">Disco C: (Sistema)</span>
            <span className="font-mono font-semibold text-amber-600">
              {sysHealth ? `${sysHealth.disk.percent}% utilizado` : '—'}
            </span>
          </div>
          <div className="w-full bg-slate-100 h-2">
            <div
              className="bg-amber-500 h-2 transition-all duration-500"
              style={{ width: `${sysHealth ? sysHealth.disk.percent : 0}%` }}
            />
          </div>
        </div>

      </div>
    </div>
  );
}
