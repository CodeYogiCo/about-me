import { useState } from 'react'

const PRESETS = {
  'Llama 2 7B':   { layers: 32, kvHeads: 32, headDim: 128, gqa: false },
  'Llama 2 13B':  { layers: 40, kvHeads: 40, headDim: 128, gqa: false },
  'Llama 2 70B':  { layers: 80, kvHeads: 8,  headDim: 128, gqa: true },
  'Llama 3 8B':   { layers: 32, kvHeads: 8,  headDim: 128, gqa: true },
  'Llama 3 70B':  { layers: 80, kvHeads: 8,  headDim: 128, gqa: true },
  'Mistral 7B':   { layers: 32, kvHeads: 8,  headDim: 128, gqa: true },
  'GPT-2 small':  { layers: 12, kvHeads: 12, headDim: 64,  gqa: false },
  'custom':       { layers: 32, kvHeads: 32, headDim: 128, gqa: false },
}

const DTYPES = {
  'fp32': 4,
  'fp16 / bf16': 2,
  'int8': 1,
  'int4': 0.5,
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes.toFixed(0)} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(2)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(2)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

export default function KVCacheCalculator() {
  const [preset, setPreset] = useState('Llama 3 8B')
  const p = PRESETS[preset]

  const [layers, setLayers] = useState(p.layers)
  const [kvHeads, setKvHeads] = useState(p.kvHeads)
  const [headDim, setHeadDim] = useState(p.headDim)
  const [dtype, setDtype] = useState('fp16 / bf16')
  const [seqLen, setSeqLen] = useState(4096)
  const [batch, setBatch] = useState(1)

  const onPresetChange = (name) => {
    setPreset(name)
    const next = PRESETS[name]
    if (name !== 'custom') {
      setLayers(next.layers)
      setKvHeads(next.kvHeads)
      setHeadDim(next.headDim)
    }
  }

  const bytesPerElement = DTYPES[dtype]
  const bytesPerTokenPerRequest = 2 * layers * kvHeads * headDim * bytesPerElement
  const totalBytes = bytesPerTokenPerRequest * seqLen * batch

  return (
    <div className="widget">
      <div className="widget-head">
        <span className="widget-title">KV cache memory calculator</span>
        <button type="button" className="widget-btn-ghost" onClick={() => onPresetChange('Llama 3 8B')}>reset</button>
      </div>
      <p className="widget-hint">
        Pick a model or enter custom dims. <strong>kv heads</strong> is the number of <em>K/V</em> heads
        (for GQA models, smaller than the number of query heads). That's what determines KV cache size.
      </p>

      <div className="widget-row-input">
        <label>
          preset:{' '}
          <select value={preset} onChange={(e) => onPresetChange(e.target.value)} className="widget-select inline">
            {Object.keys(PRESETS).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
      </div>

      <div className="widget-grid widget-grid-kv">
        <div className="wg-head">layers</div>
        <div className="wg-head">kv heads</div>
        <div className="wg-head">head dim</div>
        <div className="wg-head">dtype</div>

        <div className="wg-cell">
          <input type="number" min="1" value={layers} onChange={(e) => { setPreset('custom'); setLayers(Math.max(1, Number(e.target.value) || 1)) }} className="widget-input mono num" />
        </div>
        <div className="wg-cell">
          <input type="number" min="1" value={kvHeads} onChange={(e) => { setPreset('custom'); setKvHeads(Math.max(1, Number(e.target.value) || 1)) }} className="widget-input mono num" />
        </div>
        <div className="wg-cell">
          <input type="number" min="1" value={headDim} onChange={(e) => { setPreset('custom'); setHeadDim(Math.max(1, Number(e.target.value) || 1)) }} className="widget-input mono num" />
        </div>
        <div className="wg-cell">
          <select value={dtype} onChange={(e) => setDtype(e.target.value)} className="widget-select">
            {Object.keys(DTYPES).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>

        <div className="wg-head">seq length</div>
        <div className="wg-head">batch</div>
        <div className="wg-head" />
        <div className="wg-head" />

        <div className="wg-cell">
          <input type="number" min="1" value={seqLen} onChange={(e) => setSeqLen(Math.max(1, Number(e.target.value) || 1))} className="widget-input mono num" />
        </div>
        <div className="wg-cell">
          <input type="number" min="1" value={batch} onChange={(e) => setBatch(Math.max(1, Number(e.target.value) || 1))} className="widget-input mono num" />
        </div>
        <div className="wg-cell" />
        <div className="wg-cell" />
      </div>

      <dl className="widget-result">
        <dt>per token, per request</dt><dd className="mono">{formatBytes(bytesPerTokenPerRequest)}</dd>
        <dt>per request ({seqLen.toLocaleString()} tok)</dt><dd className="mono">{formatBytes(bytesPerTokenPerRequest * seqLen)}</dd>
        <dt>total ({batch} requests)</dt><dd className="mono accent">{formatBytes(totalBytes)}</dd>
      </dl>

      <p className="widget-foot">
        <code>kv_bytes = 2 × layers × seq_len × kv_heads × head_dim × bytes_per_element × batch</code>
      </p>
    </div>
  )
}
