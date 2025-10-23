import React, { useCallback, useEffect, useRef, useState } from "react";

type PreviewFile = {
  file: File;
  url: string;
};

const MAX_FILES = 50;

const UploadSection: React.FC = () => {
  const [files, setFiles] = useState<PreviewFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedUrls, setSelectedUrls] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const revokeUrl = useCallback((url: string) => {
    URL.revokeObjectURL(url);
  }, []);

  const handleUpload = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return;

      const incomingFiles = Array.from(fileList).filter((file) =>
        file.type.startsWith("image/")
      );

      if (incomingFiles.length === 0) {
        if (inputRef.current) {
          inputRef.current.value = "";
        }
        return;
      }

      setFiles((prev) => {
        const availableSlots = MAX_FILES - prev.length;
        if (availableSlots <= 0) {
          return prev;
        }

        const selected = incomingFiles.slice(0, availableSlots).map((file) => ({
          file,
          url: URL.createObjectURL(file),
        }));

        return [...prev, ...selected];
      });

      if (inputRef.current) {
        inputRef.current.value = "";
      }
    },
    []
  );

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      handleUpload(event.target.files);
    },
    [handleUpload]
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      setIsDragging(false);
      handleUpload(event.dataTransfer.files);
    },
    [handleUpload]
  );

  const handleDragOver = useCallback((event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLLabelElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) {
      return;
    }
    setIsDragging(false);
  }, []);

  const handleDelete = useCallback(
    (index: number) => {
      setFiles((prev) => {
        const target = prev[index];
        if (target) {
          revokeUrl(target.url);
        }
        return prev.filter((_, i) => i !== index);
      });
      setSelectedUrls((prev) => {
        const targetUrl = filesRef.current[index]?.url;
        if (!targetUrl) {
          return prev;
        }
        return prev.filter((url) => url !== targetUrl);
      });
    },
    [revokeUrl]
  );

  const handleDeleteAll = useCallback(() => {
    setFiles((prev) => {
      prev.forEach((item) => revokeUrl(item.url));
      return [];
    });
    setSelectedUrls([]);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }, [revokeUrl]);

  const handleSelectAll = useCallback(() => {
    setSelectedUrls((prev) => {
      const isAllSelected = filesRef.current.length > 0 && prev.length === filesRef.current.length;
      if (isAllSelected) {
        return [];
      }
      return filesRef.current.map((item) => item.url);
    });
  }, []);

  const filesRef = useRef<PreviewFile[]>([]);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    return () => {
      filesRef.current.forEach((item) => revokeUrl(item.url));
    };
  }, [revokeUrl]);

  useEffect(() => {
    setSelectedUrls((prev) =>
      prev.filter((url) => files.some((file) => file.url === url))
    );
  }, [files]);

  const isAllSelected = files.length > 0 && selectedUrls.length === files.length;

  return (
    <section
      className="space-y-6 rounded-lg bg-[#f5eee9] p-6 text-[#404040]"
      style={{ fontFamily: "'Pretendard', 'Noto Sans KR', sans-serif" }}
    >
      <p className="text-sm font-medium">
        이미지를 드래그하거나 클릭해서 업로드하세요 (최대 {MAX_FILES}장)
      </p>

      <label
        htmlFor="upload-input"
        className={`relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-[#e6dccc] bg-white p-8 text-center transition hover:bg-[#ffec8b] hover:shadow-md ${
          isDragging ? "border-[#ffd331] bg-[#ffec8b]" : ""
        }`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <input
          id="upload-input"
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleInputChange}
        />
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#ffd331] text-[#404040] shadow-sm">
            <span className="text-2xl font-semibold">+</span>
          </div>
          <span className="text-sm">이미지를 업로드하려면 클릭하거나 파일을 드롭하세요</span>
        </div>
        <span className="text-xs text-[#404040]/70">
          지원 형식: JPG, PNG, GIF 등 이미지 파일 (최대 {MAX_FILES}장)
        </span>
      </label>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleSelectAll}
          aria-pressed={isAllSelected}
          className={`rounded-lg border px-4 py-2 text-sm font-medium transition hover:bg-[#ffec8b] hover:shadow-md ${
            isAllSelected
              ? "border-[#ffd331] bg-[#fff3b0] text-[#404040]"
              : "border-[#e6dccc] bg-white text-[#404040]"
          }`}
        >
          전체 선택
        </button>
        <button
          type="button"
          onClick={handleDeleteAll}
          className="rounded-lg border border-[#e6dccc] bg-white px-4 py-2 text-sm font-medium text-[#404040] transition hover:bg-[#ffec8b] hover:shadow-md"
        >
          전체 삭제
        </button>
      </div>

      {files.length > 0 ? (
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-10">
          {files.map((item, index) => (
            <div
              key={item.url}
              className={`group relative h-[60px] w-[60px] overflow-hidden rounded-lg border bg-white transition hover:shadow-md ${
                selectedUrls.includes(item.url)
                  ? "border-2 border-[#ffd331] shadow-md"
                  : "border-[#e6dccc]"
              }`}
            >
              <img
                src={item.url}
                alt={`Uploaded preview ${index + 1}`}
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                aria-label="이미지 삭제"
                onClick={() => handleDelete(index)}
                className="absolute inset-0 flex items-start justify-end bg-black/0 opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100"
              >
                <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#404040] text-[10px] leading-none text-white">
                  ❌
                </span>
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-[#404040]/70">업로드된 이미지가 없습니다.</p>
      )}
    </section>
  );
};

export default UploadSection;
