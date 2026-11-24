// Family label on chips and tags (web/js/famlabel.js): short name, else name + quê gốc when two families share a name.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');
const load = () => import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', 'famlabel.js')).href);

test('short name wins; else the bare name', async () => {
  const { familyLabelOf } = await load();
  assert.equal(familyLabelOf({ id: 'a', name: 'Họ Dương', short_name: 'Dương Văn tộc' }), 'Dương Văn tộc');
  assert.equal(familyLabelOf({ id: 'a', name: 'Họ Dương', place: 'Phú Mỹ' }, [{ id: 'b', name: 'Họ Lê' }]), 'Dương');
});
test('two families with the same name: name + quê gốc (else place)', async () => {
  const { familyLabelOf } = await load();
  const a = { id: 'a', name: 'Họ Dương', place: 'Phú Mỹ' }; const b = { id: 'b', name: 'họ dương', origin_place: 'An Lạc', place: 'Hòa An' };
  assert.equal(familyLabelOf(a, [a, b]), 'Dương · Phú Mỹ');
  assert.equal(familyLabelOf(b, [a, b]), 'dương · An Lạc');
  assert.equal(familyLabelOf({ id: 'c', name: 'Họ Dương' }, [a]), 'Dương', 'no place: the name alone');
  assert.equal(familyLabelOf(null), '');
});
