import { useMemo } from 'react'
import { useImageEditor } from '../hooks/useImageEditor'

const statusStyles: Record<string, string> = {
  info: 'bg-[#1e293b] text-white',
  success: 'bg-[#16a34a] text-white',
  error: 'bg-[#dc2626] text-white',
}

function Toast() {
  const { toast } = useImageEditor()

  const className = useMemo(() => {
    if (!toast) {
      return ''
    }
    return statusStyles[toast.status] ?? statusStyles.info
  }, [toast])

  if (!toast) {
    return null
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 flex justify-center px-4 sm:px-6">
      <div
        role="status"
        className={`pointer-events-auto flex max-w-xl items-center gap-2 rounded-full px-5 py-3 text-sm font-medium shadow-lg shadow-black/30 transition ${className}`}
      >
        {toast.message}
      </div>
    </div>
  )
}

export default Toast
