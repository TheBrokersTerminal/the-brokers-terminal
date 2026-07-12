import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.0";

const OPENAI_API_KEY     = Deno.env.get("OPENAI_API_KEY")!;
const SUPABASE_URL       = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ── Ogg/Opus remuxer ─────────────────────────────────────────────────
// Combines multiple Ogg/Opus API responses into a single seekable stream.
// Without this, concatenated Ogg files are "chained" and browsers can't seek.

function buildOggCrcTable(): Uint32Array {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = (r & 0x80000000) ? (((r << 1) ^ 0x04c11db7) >>> 0) : ((r << 1) >>> 0);
    t[i] = r;
  }
  return t;
}
const OGG_CRC_TABLE = buildOggCrcTable();

function oggCrc32(buf: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < buf.length; i++) crc = ((crc << 8) ^ OGG_CRC_TABLE[((crc >>> 24) ^ buf[i]) & 0xFF]) >>> 0;
  return crc;
}

interface OggPage { headerType: number; granule: bigint; serial: number; segTable: Uint8Array; pageData: Uint8Array; }

function parseOggPages(buf: Uint8Array): OggPage[] {
  const pages: OggPage[] = [];
  let i = 0;
  while (i + 27 <= buf.length) {
    if (buf[i] !== 79 || buf[i+1] !== 103 || buf[i+2] !== 103 || buf[i+3] !== 83 || buf[i+4] !== 0) { i++; continue; }
    const headerType = buf[i+5];
    const gl = BigInt((buf[i+6] | buf[i+7]<<8 | buf[i+8]<<16 | buf[i+9]<<24) >>> 0);
    const gh = BigInt((buf[i+10] | buf[i+11]<<8 | buf[i+12]<<16 | buf[i+13]<<24) >>> 0);
    const granule = gl | (gh << 32n);
    const serial = (buf[i+14] | buf[i+15]<<8 | buf[i+16]<<16 | buf[i+17]<<24) >>> 0;
    const numSegs = buf[i+26];
    if (i + 27 + numSegs > buf.length) break;
    const segTable = buf.slice(i+27, i+27+numSegs);
    let dataLen = 0; for (let s = 0; s < numSegs; s++) dataLen += segTable[s];
    if (i + 27 + numSegs + dataLen > buf.length) break;
    pages.push({ headerType, granule, serial, segTable, pageData: buf.slice(i+27+numSegs, i+27+numSegs+dataLen) });
    i += 27 + numSegs + dataLen;
  }
  return pages;
}

function writeOggPage(headerType: number, granule: bigint, serial: number, seqNum: number, segTable: Uint8Array, pageData: Uint8Array): Uint8Array {
  const buf = new Uint8Array(27 + segTable.length + pageData.length);
  buf[0]=79; buf[1]=103; buf[2]=103; buf[3]=83; buf[4]=0; buf[5]=headerType;
  const gl = Number(granule & 0xFFFFFFFFn), gh = Number((granule >> 32n) & 0xFFFFFFFFn);
  buf[6]=gl&255; buf[7]=(gl>>8)&255; buf[8]=(gl>>16)&255; buf[9]=(gl>>24)&255;
  buf[10]=gh&255; buf[11]=(gh>>8)&255; buf[12]=(gh>>16)&255; buf[13]=(gh>>24)&255;
  buf[14]=serial&255; buf[15]=(serial>>8)&255; buf[16]=(serial>>16)&255; buf[17]=(serial>>24)&255;
  buf[18]=seqNum&255; buf[19]=(seqNum>>8)&255; buf[20]=(seqNum>>16)&255; buf[21]=(seqNum>>24)&255;
  buf[26]=segTable.length; buf.set(segTable, 27); buf.set(pageData, 27+segTable.length);
  const crc = oggCrc32(buf);
  buf[22]=crc&255; buf[23]=(crc>>8)&255; buf[24]=(crc>>16)&255; buf[25]=(crc>>24)&255;
  return buf;
}

const NEG1 = 0xFFFFFFFFFFFFFFFFn; // granule -1 used on Opus header pages

function remuxOpusChunks(chunks: Uint8Array[]): Uint8Array {
  const SERIAL = 0xB501B501 >>> 0;
  let seqNum = 0, granuleOffset = 0n;
  const out: Uint8Array[] = [];

  for (let ci = 0; ci < chunks.length; ci++) {
    const pages = parseOggPages(chunks[ci]);
    // Find end granule for this chunk (for offset calculation)
    let chunkEnd = 0n;
    for (const p of pages) if (p.granule !== NEG1 && p.granule > 0n) chunkEnd = p.granule;

    let pageIdx = 0;
    for (const p of pages) {
      // Skip header pages (OpusHead + OpusTags) from chunk 1 onwards
      if (ci > 0 && pageIdx < 2) { pageIdx++; continue; }

      let ht = p.headerType & ~0x04; // clear EOS on all (re-add to last page later)
      if (ci > 0) ht &= ~0x02;       // clear BOS on non-first chunks

      const newGranule = (p.granule === NEG1 || p.granule === 0n) ? p.granule : p.granule + granuleOffset;
      out.push(writeOggPage(ht, newGranule, SERIAL, seqNum++, p.segTable, p.pageData));
      pageIdx++;
    }
    granuleOffset += chunkEnd;
  }

  // Mark final page as EOS
  if (out.length > 0) {
    const last = new Uint8Array(out[out.length - 1]);
    last[5] |= 0x04;
    last[22]=0; last[23]=0; last[24]=0; last[25]=0;
    const crc = oggCrc32(last);
    last[22]=crc&255; last[23]=(crc>>8)&255; last[24]=(crc>>16)&255; last[25]=(crc>>24)&255;
    out[out.length - 1] = last;
  }

  let total = 0; for (const p of out) total += p.length;
  const result = new Uint8Array(total);
  let offset = 0; for (const p of out) { result.set(p, offset); offset += p.length; }
  return result;
}

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Content-Type": "application/json",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  let reportId: string | undefined;
  try {
    let filePath: string;
    ({ reportId, filePath } = await req.json());
    if (!reportId || !filePath) {
      return new Response(JSON.stringify({ error: "Missing reportId or filePath" }), { status: 400, headers: CORS });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // 1. Mark as generating
    await supabase.from("reports").update({ audio_url: "generating" }).eq("id", reportId);

    // 2. Fetch HTML from storage
    const { data: fileData, error: fileError } = await supabase.storage
      .from("Reports")
      .download(filePath);

    if (fileError || !fileData) throw new Error("Could not fetch report file: " + fileError?.message);

    const html = await fileData.text();

    // 3. Extract clean prose text from HTML
    const text = extractText(html);
    if (!text || text.length < 50) throw new Error("Could not extract readable text from report");

    // 4. Split into chunks ≤ 3800 chars at sentence boundaries (OpenAI limit is 4096)
    const chunks = splitIntoChunks(text, 3800);

    // 5. Generate audio for all chunks in parallel via OpenAI TTS
    const audioBuffers: Uint8Array[] = await Promise.all(
      chunks.map(async (chunk) => {
        const res = await fetch("https://api.openai.com/v1/audio/speech", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "tts-1-hd",
            input: chunk,
            voice: "onyx",
            response_format: "opus",
          }),
        });
        if (!res.ok) {
          const errText = await res.text();
          throw new Error("OpenAI TTS failed: " + errText);
        }
        return new Uint8Array(await res.arrayBuffer());
      })
    );

    // 6. Remux Opus chunks into a single seekable Ogg stream
    const combined = audioBuffers.length === 1 ? audioBuffers[0] : remuxOpusChunks(audioBuffers);

    // 7. Upload to Supabase storage under audio/
    const audioPath = `audio/${reportId}.opus`;
    const { error: uploadErr } = await supabase.storage
      .from("Reports")
      .upload(audioPath, combined, { contentType: "audio/ogg", upsert: true });
    if (uploadErr) throw new Error("Upload failed: " + uploadErr.message);

    // 8. Get public URL and save to reports table
    const { data: urlData } = supabase.storage.from("Reports").getPublicUrl(audioPath);
    const audioUrl = urlData.publicUrl;

    const { error: dbErr } = await supabase.from("reports").update({ audio_url: audioUrl }).eq("id", reportId);
    if (dbErr) throw new Error("DB update failed: " + dbErr.message);

    return new Response(JSON.stringify({ success: true, audioUrl }), { headers: CORS });

  } catch (err) {
    console.error("generate-report-audio error:", err);
    if (reportId) {
      try {
        const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        await sb.from("reports").update({ audio_url: null }).eq("id", reportId);
      } catch { /* ignore */ }
    }
    return new Response(JSON.stringify({ error: String(err.message || err) }), { status: 500, headers: CORS });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────

function extractText(html: string): string {
  let t = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ");

  // Decode common HTML entities
  t = t
    .replace(/&mdash;/g, " — ")
    .replace(/&ndash;/g, " – ")
    .replace(/&amp;/g,   "&")
    .replace(/&nbsp;/g,  " ")
    .replace(/&bull;/g,  ". ")
    .replace(/&lt;/g,    "<")
    .replace(/&gt;/g,    ">")
    .replace(/&quot;/g,  '"')
    .replace(/&#39;/g,   "'")
    .replace(/&#[0-9]+;/g, " ")  // numeric entities (decorative block chars etc.)
    .replace(/&[a-z]+;/g,  " "); // remaining named entities

  // Remove lines that are purely decorative (block/line-drawing characters)
  t = t.split(/\n/).map(l => l.replace(/[─═■▬▸▹►◆•█▌▐░▒▓◘○●□■]+/g, " ").trim())
       .filter(l => l.replace(/[\s\W]/g, "").length > 6)
       .join(" ");

  return t.replace(/\s{2,}/g, " ").trim();
}

function splitIntoChunks(text: string, max: number): string[] {
  const chunks: string[] = [];
  let rem = text;
  while (rem.length > max) {
    let at = rem.lastIndexOf(". ", max);
    if (at < max * 0.5) at = rem.lastIndexOf(" ", max);
    if (at < 1) at = max;
    chunks.push(rem.slice(0, at + 1).trim());
    rem = rem.slice(at + 1).trim();
  }
  if (rem) chunks.push(rem);
  return chunks;
}
