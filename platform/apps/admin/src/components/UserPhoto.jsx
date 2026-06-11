import React, { useEffect, useState } from 'react';

/**
 * Fetches a user photo via /api/users/:userId/photo with credentials (handles auth).
 * Falls back to initials div if no photo / fetch fails.
 *
 * Props:
 *   userId   — UUID of the user
 *   initials — fallback text (e.g. "D")
 *   size     — tailwind size classes, default "w-8 h-8 text-sm"
 *   onClick  — optional click handler (for lightbox)
 */
export function UserPhoto({ userId, initials = '?', size = 'w-8 h-8 text-sm', onClick }) {
    const [blobUrl, setBlobUrl] = useState(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (!userId) { setFailed(true); return; }
        let url;
        fetch(`/api/users/${userId}/photo`, { credentials: 'include' })
            .then(r => r.ok ? r.blob() : Promise.reject())
            .then(blob => { url = URL.createObjectURL(blob); setBlobUrl(url); })
            .catch(() => setFailed(true));
        return () => { if (url) URL.revokeObjectURL(url); };
    }, [userId]);

    const base = `${size} rounded-full shrink-0 overflow-hidden`;

    if (blobUrl) {
        return (
            <img
                src={blobUrl}
                alt={initials}
                onClick={onClick}
                className={`${base} object-cover border border-gray-700 ${onClick ? 'cursor-pointer hover:opacity-90 transition-opacity' : ''}`}
            />
        );
    }

    return (
        <div className={`${base} bg-brand/20 flex items-center justify-center font-bold text-brand`}>
            {initials}
        </div>
    );
}

/** Full-screen lightbox for zooming in on a photo */
export function PhotoLightbox({ blobUrl, initials, onClose }) {
    useEffect(() => {
        const handler = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onClose]);

    return (
        <div
            className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center"
            onClick={onClose}
        >
            {blobUrl
                ? <img src={blobUrl} alt={initials} className="max-w-[90vw] max-h-[90vh] rounded-2xl shadow-2xl object-contain" onClick={e => e.stopPropagation()} />
                : <div className="w-48 h-48 rounded-full bg-brand/30 flex items-center justify-center text-6xl font-bold text-brand">{initials}</div>
            }
            <button onClick={onClose} className="absolute top-4 right-4 text-white/60 hover:text-white text-2xl">✕</button>
        </div>
    );
}

/** Large avatar with built-in lightbox on click */
export function UserPhotoWithZoom({ userId, initials = '?', size = 'w-20 h-20 text-2xl' }) {
    const [blobUrl, setBlobUrl] = useState(null);
    const [lightbox, setLightbox] = useState(false);

    useEffect(() => {
        if (!userId) return;
        let url;
        fetch(`/api/users/${userId}/photo`, { credentials: 'include' })
            .then(r => r.ok ? r.blob() : Promise.reject())
            .then(blob => { url = URL.createObjectURL(blob); setBlobUrl(url); })
            .catch(() => {});
        return () => { if (url) URL.revokeObjectURL(url); };
    }, [userId]);

    const base = `${size} rounded-full shrink-0 overflow-hidden`;

    return (
        <>
            {blobUrl ? (
                <img
                    src={blobUrl}
                    alt={initials}
                    onClick={() => setLightbox(true)}
                    className={`${base} object-cover border-2 border-gray-700 cursor-pointer hover:border-brand/60 transition-colors`}
                />
            ) : (
                <div className={`${base} bg-brand/20 flex items-center justify-center font-bold text-brand`}>
                    {initials}
                </div>
            )}
            {lightbox && blobUrl && (
                <PhotoLightbox blobUrl={blobUrl} initials={initials} onClose={() => setLightbox(false)} />
            )}
        </>
    );
}
