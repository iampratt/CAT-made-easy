import Image from 'next/image';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function DilrPanel({ setImageUrl, setText }: { setImageUrl?: string | null; setText?: string | null }) {
  return (
    <article className="card" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
      <h4 style={{ marginTop: 0 }}>DILR Data Setup</h4>
      {setImageUrl ? (
        <Image src={setImageUrl} alt="DILR data setup" width={800} height={600} style={{ width: '100%', height: 'auto' }} unoptimized />
      ) : (
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{setText ?? 'No set data available.'}</ReactMarkdown>
      )}
    </article>
  );
}
