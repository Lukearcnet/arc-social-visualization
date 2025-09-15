import { get } from '@vercel/blob';

export default async function handler(req, res) {
  try {
    const blob = await get('comprehensive_data.json', { type: 'application/json' });

    if (!blob) {
      return res.status(404).json({ error: 'Data not found' });
    }

    const data = await blob.json();
    return res.status(200).json(data);

  } catch (error) {
    console.error('❌ Error serving data:', error);
    return res.status(500).json({ error: 'Failed to retrieve data', detail: error.message });
  }
}
