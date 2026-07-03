'use client'

import { useRef, useState } from 'react'
import { ComingSoonBadge } from './ComingSoon'

interface Props {
  onFile: (file: File) => void
  loading: boolean
  error: string | null
}

export function UploadDropzone({ onFile, loading, error }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)

  function pick(file: File | undefined | null) {
    if (!file) return
    onFile(file)
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <h2 className="mb-1 text-2xl font-semibold tracking-tight text-gray-900">
        Ask your spreadsheet a question
      </h2>
      <p className="mb-6 text-sm text-gray-500">
        Upload a CSV. It is profiled and analyzed locally — only the profile and
        a small sample ever leave your server.
      </p>

      <div
        data-testid="dropzone"
        role="button"
        tabIndex={0}
        aria-disabled={loading}
        onClick={() => !loading && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !loading)
            inputRef.current?.click()
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragActive(true)
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragActive(false)
          if (!loading) pick(e.dataTransfer.files?.[0])
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-14 text-center transition ${
          dragActive
            ? 'border-indigo-500 bg-indigo-50'
            : 'border-gray-300 bg-white hover:border-indigo-400 hover:bg-gray-50'
        } ${loading ? 'pointer-events-none opacity-60' : ''}`}
      >
        <input
          ref={inputRef}
          data-testid="file-input"
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />
        {loading ? (
          <div data-testid="upload-loading" className="flex flex-col items-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
            <p className="mt-3 text-sm text-gray-600">Profiling your file…</p>
          </div>
        ) : (
          <>
            <div className="text-3xl">📄</div>
            <p className="mt-3 text-sm font-medium text-gray-700">
              Drop a CSV here, or click to browse
            </p>
            <p className="mt-1 text-xs text-gray-400">CSV up to ~100MB</p>
          </>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-gray-400">
        <span className="inline-flex items-center">
          Add another file · Excel sheets
          <ComingSoonBadge label="P3" />
        </span>
      </div>

      {error && (
        <div
          data-testid="upload-error"
          className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}
    </div>
  )
}
