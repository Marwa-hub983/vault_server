import { db } from '../db.js';
import { bufferToF32 } from '../utils.js';


function dot(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
    return sum;
}
export function retrieve(userId, queryVec, scope, k, minScore) {
    let sql = `SELECT c.id,c.document_id,c.page,c.text,c.embedding,d.title
    FROM chunks c JOIN documents d ON d.id = c.document_id
    WHERE d.user_id = ? AND d.status ='ready'`;
    const params = [userId];
    if (scope.type === 'document') { sql += ' AND d.id = ?'; params.push(Number(scope.value)); }
    if (scope.type === 'folder') {
        sql += ' AND d.folder = ?';
        params.push(String(scope.value));
    }
    const rows = db.prepare(sql).all(...params);
    const q = Float32Array.from(queryVec);
    const scored = rows.map((r) => ({
        id: r.id,
        document_id: r.document_id,
        title: r.title,
        page: r.page,
        text: r.text,
        score: dot(q, bufferToF32(r.embedding)),
    }));
    return scored.filter((r) => r.score >= minScore).sort((a, b) => b.score - a.score).slice(0, k);
}