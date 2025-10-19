import { useCanvasExport, type CanvasRef } from '../hooks/useCanvasExport'

type DownloadButtonProps = {
  canvasRef: CanvasRef
  filename?: string
  label?: string
  className?: string
  disabled?: boolean
  id?: string
  title?: string
}

export function DownloadButton({
  canvasRef,
  filename = 'image.png',
  label = 'PNG 다운로드',
  className,
  disabled,
  id,
  title,
}: DownloadButtonProps) {
  const exporter = useCanvasExport(canvasRef, filename)
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  const classes = ['download-button']
  if (className) classes.push(className)
  button.className = classes.join(' ')
  if (id) button.id = id
  if (title) button.title = title
  button.disabled = Boolean(disabled)

  button.addEventListener('click', (event) => {
    if (button.disabled) {
      event.preventDefault()
      return
    }

    const target = canvasRef.current
    if (!(target instanceof HTMLCanvasElement)) {
      event.preventDefault()
      return
    }

    event.preventDefault()
    const previousText = button.textContent
    button.disabled = true
    button.textContent = '내보내는 중…'

    void exporter
      .exportAsPng({ filename })
      .catch(() => {})
      .finally(() => {
        button.disabled = Boolean(disabled)
        button.textContent = previousText || label
      })
  })

  return button
}

export default DownloadButton
