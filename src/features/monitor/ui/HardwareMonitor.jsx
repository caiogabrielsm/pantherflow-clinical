// src/features/monitor/ui/HardwareMonitor.jsx
export default function HardwareMonitor({ sysHealth }) {
  return (
    <div className="w-full h-full bg-white flex flex-col">
      <div className="px-6 py-4 border-b border-slate-200">
        <h3 className="font-bold text-slate-800">Carga do Sistema</h3>
      </div>

      <div className="p-8 flex-1 flex flex-col justify-center gap-10">

        {/* Memória RAM */}
        <div>
          <div className="flex justify-between text-sm mb-2.5">
            <span className="text-slate-500 font-medium">Memória RAM</span>
            <span className="font-bold text-slate-700">
              {sysHealth ? sysHealth.ram.label : 'Carregando...'}
            </span>
          </div>
          <div className="w-full bg-slate-200 rounded-full h-3">
            <div
              className="bg-violet-600 h-3 rounded-full transition-all duration-500"
              style={{ width: `${sysHealth ? sysHealth.ram.percent : 0}%` }}
            />
          </div>
        </div>

        {/* CPU */}
        <div>
          <div className="flex justify-between text-sm mb-2.5">
            <span className="text-slate-500 font-medium">Uso de CPU ({sysHealth?.cpu?.threads || '...'})</span>
            <span className="font-bold text-slate-700">
              {sysHealth ? `${sysHealth.cpu.percent}%` : 'Carregando...'}
            </span>
          </div>
          <div className="w-full bg-slate-200 rounded-full h-3">
            <div
              className="bg-emerald-500 h-3 rounded-full transition-all duration-500"
              style={{ width: `${sysHealth ? sysHealth.cpu.percent : 0}%` }}
            />
          </div>
        </div>

        {/* Disco */}
        <div>
          <div className="flex justify-between text-sm mb-2.5">
            <span className="text-slate-500 font-medium">Disco C: (Sistema)</span>
            <span className="font-bold text-amber-600">
              {sysHealth ? `${sysHealth.disk.percent}% Utilizado` : 'Carregando...'}
            </span>
          </div>
          <div className="w-full bg-slate-200 rounded-full h-3">
            <div
              className="bg-amber-500 h-3 rounded-full transition-all duration-500"
              style={{ width: `${sysHealth ? sysHealth.disk.percent : 0}%` }}
            />
          </div>
        </div>

      </div>
    </div>
  );
}