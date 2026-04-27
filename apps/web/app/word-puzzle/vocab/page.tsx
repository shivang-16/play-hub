'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Volume2, ChevronDown, ChevronUp, Search, Filter } from 'lucide-react';
import VOCAB_WORDS, { ALL_TAGS, type VocabTag } from './vocab-data';
import styles from './vocab.module.css';

export default function VocabPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [activeTag, setActiveTag] = useState<VocabTag | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);

  // Pre-load voices as soon as the browser has them — avoids the blank-list
  // on first call that causes the choppy fallback voice.
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const load = () => { voicesRef.current = window.speechSynthesis.getVoices(); };
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  const filtered = useMemo(() => {
    let list = VOCAB_WORDS;
    if (activeTag) {
      list = list.filter((w) => w.tag === activeTag);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (w) =>
          w.word.toLowerCase().includes(q) ||
          w.meaning.toLowerCase().includes(q) ||
          w.synonyms.some((s) => s.toLowerCase().includes(q))
      );
    }
    return list;
  }, [search, activeTag]);

  const handlePronounce = useCallback((word: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word.toLowerCase());
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    // Use pre-loaded voices so the first call is never stuck with an empty list
    const voices = voicesRef.current.length
      ? voicesRef.current
      : window.speechSynthesis.getVoices();
    const femaleVoice =
      voices.find(
        (v) =>
          v.lang.startsWith('en') &&
          /female|samantha|victoria|karen|fiona|zira|susan/i.test(v.name)
      ) ??
      voices.find(
        (v) => v.lang.startsWith('en') && /woman|girl/i.test(v.name)
      );
    if (femaleVoice) utterance.voice = femaleVoice;
    window.speechSynthesis.speak(utterance);
  }, []);

  return (
    <div className={styles.page}>
      {/* Sticky top bar */}
      <header className={styles.topBar}>
        <button className={styles.backBtn} onClick={() => router.push('/word-puzzle')}>
          <ArrowLeft size={14} /> Back
        </button>
        <span className={styles.pageTitle}>Word Vault</span>
        <span className={styles.wordCount}>{filtered.length} words</span>
      </header>

      {/* Hero */}
      <div className={styles.hero}>
        <h1 className={styles.heroTitle}>Expand Your Vocabulary</h1>
        <p className={styles.heroDesc}>
          Discover rare, beautiful, and powerful words that most people never use.
          Tap a card to reveal synonyms and examples.
        </p>
      </div>

      {/* Search */}
      <div className={styles.searchWrap}>
        <Search size={16} className={styles.searchIcon} />
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Search words, meanings, or synonyms..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Tag filters */}
      <div className={styles.tagFilterWrap}>
        <Filter size={13} className={styles.tagFilterIcon} />
        <div className={styles.tagFilters}>
          <button
            className={`${styles.tagChip} ${activeTag === null ? styles.tagChipActive : ''}`}
            onClick={() => setActiveTag(null)}
          >
            All
          </button>
          {ALL_TAGS.map((t) => (
            <button
              key={t.id}
              className={`${styles.tagChip} ${activeTag === t.id ? styles.tagChipActive : ''}`}
              onClick={() => setActiveTag(activeTag === t.id ? null : t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Cards */}
      {filtered.length === 0 ? (
        <div className={styles.empty}>
          <Search size={32} className={styles.emptyIcon} />
          <p className={styles.emptyText}>No words match &quot;{search}&quot;</p>
        </div>
      ) : (
        <div className={styles.grid}>
          {filtered.map((w, i) => {
            const isOpen = openId === i;
            return (
              <div
                key={`${w.word}-${i}`}
                className={`${styles.card} ${isOpen ? styles.cardOpen : ''}`}
                onClick={() => setOpenId(isOpen ? null : i)}
              >
                <div className={styles.cardHeader}>
                  <span className={styles.cardWord}>{w.word}</span>
                  <span className={styles.cardPos}>{w.partOfSpeech}</span>
                  <span className={styles.cardTag}>{w.tag}</span>
                  <div className={styles.cardActions}>
                    <button
                      className={styles.iconBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePronounce(w.word);
                      }}
                      title={`Pronounce "${w.word}"`}
                    >
                      <Volume2 size={14} />
                    </button>
                    <button
                      className={`${styles.iconBtn} ${isOpen ? styles.iconBtnActive : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenId(isOpen ? null : i);
                      }}
                      title={isOpen ? 'Collapse' : 'Expand'}
                    >
                      {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  </div>
                </div>

                <p className={styles.cardMeaning}>{w.meaning}</p>

                {isOpen && (
                  <div className={styles.cardDetails}>
                    <p className={styles.detailLabel}>Synonyms</p>
                    <div className={styles.synonyms}>
                      {w.synonyms.map((s) => (
                        <span key={s} className={styles.synonymChip}>{s}</span>
                      ))}
                    </div>

                    <p className={styles.detailLabel}>Example</p>
                    <p className={styles.exampleText}>&ldquo;{w.example}&rdquo;</p>
                  </div>
                )}

                {!isOpen && <span className={styles.expandHint}>tap to expand</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
