const fs = require('fs');

const NOTION_KEY = process.env.NOTION_API_KEY;
const PAGE_ID = '2e80aff1-c9a9-8092-b8ed-f7b2dd0bed4e';
const NOTION_VERSION = '2025-09-03';

if (!NOTION_KEY) {
  console.error('Error: NOTION_API_KEY is not set.');
  process.exit(1);
}

async function notionRequest(path, method = 'GET', body = null) {
  const url = `https://api.notion.com/v1${path}`;
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${NOTION_KEY}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion API Error ${res.status}: ${text}`);
  }
  return res.json();
}

async function getCodeBlock() {
  // Get children of the page
  const data = await notionRequest(`/blocks/${PAGE_ID}/children`);
  const codeBlock = data.results.find(b => b.type === 'code');
  if (!codeBlock) {
    throw new Error('No code block found on the page.');
  }
  return {
    id: codeBlock.id,
    content: codeBlock.code.rich_text[0]?.plain_text || ''
  };
}

async function updateCodeBlock(blockId, newContent) {
  // Notion allows updating code block content
  // Note: rich_text is an array. We'll replace it entirely.
  // Split content if it's too long? Notion has a limit (2000 chars per text object), 
  // but a code block can hold more if split into multiple text objects.
  // For safety, let's split into chunks of 2000 chars.
  
  const chunks = [];
  for (let i = 0; i < newContent.length; i += 2000) {
    chunks.push({
      type: 'text',
      text: { content: newContent.substring(i, i + 2000) }
    });
  }

  await notionRequest(`/blocks/${blockId}`, 'PATCH', {
    code: {
      rich_text: chunks
    }
  });
}

// --- Domain Logic ---

function parsePRM(text) {
  const lines = text.split('\n');
  const people = [];
  let currentPerson = null;
  let preamble = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('## ')) {
      if (currentPerson) people.push(currentPerson);
      currentPerson = {
        name: line.substring(3).trim(),
        rawLines: [line], // Store raw lines to preserve formatting exactly
        id: null,
        notesStartIndex: -1
      };
    } else if (currentPerson) {
      currentPerson.rawLines.push(line);
      if (line.trim().startsWith('id:')) {
        currentPerson.id = line.split(':')[1].trim();
      }
    } else {
      preamble += line + '\n';
    }
  }
  if (currentPerson) people.push(currentPerson);

  return { preamble, people };
}

function serializePRM(preamble, people) {
  let text = preamble.trimEnd(); // Preamble usually "# People"
  if (text) text += '\n\n';
  
  text += people.map(p => p.rawLines.join('\n')).join('\n\n');
  // Ensure strict spacing? The parser stores rawLines, so spacing *within* a block is preserved.
  // We just need to join blocks with double newline.
  // Wait, if rawLines includes the trailing newlines of the previous block, we might double up.
  // Let's inspect how we capture rawLines.
  
  // Actually, let's reconstruct clean blocks.
  // The user wants strict structure.
  
  return people.map(p => p.rawLines.join('\n')).reduce((acc, curr) => {
    // If acc is just preamble
    if (acc === '# People') return acc + '\n\n' + curr;
    return acc + '\n\n' + curr;
  }, preamble.trim());
}

// Better parser that separates structure
function parsePRMStructured(text) {
  // Split by "\n## " to separate blocks.
  // First part is preamble.
  const parts = text.split(/\n## /);
  const preamble = parts[0];
  const peopleRaw = parts.slice(1);
  
  const people = peopleRaw.map(raw => {
    const lines = raw.split('\n');
    const name = lines[0].trim(); // The part after ##
    const idLine = lines.find(l => l.trim().startsWith('id:'));
    const id = idLine ? idLine.split('id:')[1].trim() : null;
    
    // Find index of "### Notes"
    const notesHeaderIndex = lines.findIndex(l => l.trim() === '### Notes');
    
    let metadataLines = [];
    let notesLines = [];
    
    if (notesHeaderIndex !== -1) {
      metadataLines = lines.slice(1, notesHeaderIndex);
      notesLines = lines.slice(notesHeaderIndex + 1); // Content after ### Notes
    } else {
      metadataLines = lines.slice(1);
    }
    
    // Parse metadata into key-value
    const metadata = {};
    const metadataOrder = []; // maintain order
    metadataLines.forEach(l => {
      const match = l.match(/^([a-z_]+):\s*(.*)$/);
      if (match) {
        metadata[match[1]] = match[2];
        metadataOrder.push(match[1]);
      } else if (l.trim() !== '') {
        // preserve unknown lines in metadata section
        metadataOrder.push({raw: l});
      }
    });

    return {
      name,
      id,
      metadata,
      metadataOrder,
      notesLines,
      raw: '## ' + raw
    };
  });
  
  return { preamble, people };
}

function serializePerson(person) {
  let block = `## ${person.name}`;
  
  // Reconstruct metadata
  // We want specific order: id, spouse, tags, last_updated
  // But we should respect existing order if possible, or enforce canonical.
  // User said: "This structure is canonical and must not drift."
  // ## Name
  // id: ...
  // spouse: ...
  // tags: ...
  // last_updated: ...
  
  // Let's enforce the canonical order for known fields, then others.
  const canonicalFields = ['id', 'spouse', 'tags', 'last_updated'];
  
  canonicalFields.forEach(field => {
    if (person.metadata[field] !== undefined) {
      block += `\n${field}: ${person.metadata[field]}`;
    } else if (field === 'tags' || field === 'spouse') {
       // Only add if it existed or we want to enforce presence?
       // The example showed: spouse: <blank> or name.
       // The prompt says: "spouse: <name or blank>"
       // So we should probably keep it if it was there.
    }
  });

  // Add any other metadata found (custom fields)
  person.metadataOrder.forEach(item => {
    if (typeof item === 'object' && item.raw) {
       block += `\n${item.raw}`;
    } else if (typeof item === 'string' && !canonicalFields.includes(item)) {
       block += `\n${item}: ${person.metadata[item]}`;
    }
  });
  
  block += `\n\n### Notes`;
  // Filter empty lines from notesLines
  const notes = person.notesLines.filter(l => l.trim() !== '');
  if (notes.length > 0) {
    block += `\n${notes.join('\n')}`;
  }
  
  return block;
}

function reconstructFullText(preamble, people) {
  return preamble + '\n\n' + people.map(serializePerson).join('\n\n');
}

// --- Commands ---

async function cmdList() {
  const { content } = await getCodeBlock();
  const { people } = parsePRMStructured(content);
  people.forEach(p => {
    console.log(`${p.name} (id: ${p.id})`);
  });
}

async function cmdGet(query) {
  const { content } = await getCodeBlock();
  const { people } = parsePRMStructured(content);
  const person = people.find(p => p.id === query || p.name.toLowerCase().includes(query.toLowerCase()));
  if (!person) {
    console.log('Person not found.');
    return;
  }
  console.log(serializePerson(person));
}

async function cmdAddNote(query, note, date) {
  const { id: blockId, content } = await getCodeBlock();
  const { preamble, people } = parsePRMStructured(content);
  
  const person = people.find(p => p.id === query || p.name.toLowerCase() === query.toLowerCase());
  if (!person) {
    console.error(`Person "${query}" not found.`);
    process.exit(1);
  }

  const dateStr = date || new Date().toISOString().split('T')[0];
  const newNoteLine = `- ${dateStr}: ${note}`;
  
  person.notesLines.push(newNoteLine);
  person.metadata['last_updated'] = dateStr;
  
  const newText = reconstructFullText(preamble, people);
  await updateCodeBlock(blockId, newText);
  console.log(`Added note to ${person.name}`);
}

async function cmdUpdatePerson(query, field, value) {
  const { id: blockId, content } = await getCodeBlock();
  const { preamble, people } = parsePRMStructured(content);
  
  const person = people.find(p => p.id === query || p.name.toLowerCase() === query.toLowerCase());
  if (!person) {
    console.error(`Person "${query}" not found.`);
    process.exit(1);
  }
  
  if (field === 'id') {
    console.error('Changing ID is forbidden.');
    process.exit(1);
  }
  
  person.metadata[field] = value;
  
  // Ensure field is in metadataOrder
  if (!person.metadataOrder.includes(field)) {
      // Insert in logical place.
      // If spouse, after id. If last_updated, at end of meta.
      if (field === 'spouse') {
          // Find index of id
          const idIdx = person.metadataOrder.indexOf('id');
          person.metadataOrder.splice(idIdx + 1, 0, 'spouse');
      } else {
          person.metadataOrder.push(field);
      }
  }

  const newText = reconstructFullText(preamble, people);
  await updateCodeBlock(blockId, newText);
  console.log(`Updated ${field} for ${person.name}`);
}

async function cmdAddPerson(fullName, id, spouse, initialNote) {
  const { id: blockId, content } = await getCodeBlock();
  const { preamble, people } = parsePRMStructured(content);
  
  if (people.find(p => p.id === id)) {
      console.error('ID already exists.');
      process.exit(1);
  }
  
  const today = new Date().toISOString().split('T')[0];
  
  const newPerson = {
      name: fullName,
      id: id,
      metadata: {
          id: id,
          spouse: spouse || 'nan',
          last_updated: today
      },
      metadataOrder: ['id', 'spouse', 'last_updated'],
      notesLines: []
  };
  
  if (initialNote) {
      newPerson.notesLines.push(`- ${today}: ${initialNote}`);
  }
  
  people.push(newPerson);
  const newText = reconstructFullText(preamble, people);
  await updateCodeBlock(blockId, newText);
  console.log(`Added person ${fullName}`);
}

// --- Main ---

const args = process.argv.slice(2);
const command = args[0];

(async () => {
  try {
    switch (command) {
      case 'list':
        await cmdList();
        break;
      case 'get':
        await cmdGet(args[1]);
        break;
      case 'add-note':
        // args: query, note, [date]
        await cmdAddNote(args[1], args[2], args[3]);
        break;
      case 'update-person':
        await cmdUpdatePerson(args[1], args[2], args[3]);
        break;
      case 'add-person':
        // args: name, id, spouse, note
        await cmdAddPerson(args[1], args[2], args[3], args[4]);
        break;
      default:
        console.log('Unknown command');
    }
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
