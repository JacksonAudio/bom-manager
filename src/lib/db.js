// ============================================================
// src/lib/db.js
// Thursday, March 12, 2026
//
// All Supabase queries live here.
// The UI never calls supabase directly — it calls these helpers.
// This makes it easy to swap the backend later without touching components.
// ============================================================

import { supabase } from './supabase.js'

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

// Throw on Supabase errors so callers can catch uniformly
function check(error, context) {
  if (error) throw new Error(`[db:${context}] ${error.message}`)
}

// ─────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────

// Sign up with email + password
export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password })
  check(error, 'signUp')
  return data
}

// Sign in with email + password
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  check(error, 'signIn')
  return data
}

// Sign out the current session
export async function signOut() {
  const { error } = await supabase.auth.signOut()
  check(error, 'signOut')
}

// Get current authenticated user (null if not logged in)
export async function getUser() {
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

// Subscribe to auth state changes (login/logout)
// Returns unsubscribe function — call it on component unmount
export function onAuthChange(callback) {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null)
  })
  return () => subscription.unsubscribe()
}

// ─────────────────────────────────────────────
// PRODUCTS
// ─────────────────────────────────────────────

// Fetch all products, newest first, with creator's email
export async function fetchProducts() {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: false })
  check(error, 'fetchProducts')
  return data
}

// Insert a new product and return the created row
export async function createProduct({ name, color, userId, shopify_product_id, brand }) {
  const row = { name, color, created_by: userId };
  if (shopify_product_id) row.shopify_product_id = shopify_product_id;
  if (brand) row.brand = brand;
  const { data, error } = await supabase
    .from('products')
    .insert(row)
    .select()
    .single()
  check(error, 'createProduct')
  return data
}

// Update a product's name or color
export async function updateProduct(id, fields) {
  const { error } = await supabase
    .from('products')
    .update(fields)
    .eq('id', id)
  check(error, 'updateProduct')
}

// Delete a product by id (parts with this product_id become unassigned via set null FK)
export async function deleteProduct(id) {
  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', id)
  check(error, 'deleteProduct')
}

// ─────────────────────────────────────────────
// PARTS
// ─────────────────────────────────────────────

// Fetch all parts, ordered by created_at ascending
export async function fetchParts() {
  const { data, error } = await supabase
    .from('parts')
    .select('*')
    .order('created_at', { ascending: true })
  check(error, 'fetchParts')
  return data
}

// Insert one part — returns the new row
export async function createPart(fields, userId) {
  const { data, error } = await supabase
    .from('parts')
    .insert({ ...fields, created_by: userId, updated_by: userId })
    .select()
    .single()
  check(error, 'createPart')
  return data
}

// Update one field (or many fields) on a part
export async function updatePart(id, fields, userId) {
  const { error } = await supabase
    .from('parts')
    .update({ ...fields, updated_by: userId })
    .eq('id', id)
  check(error, 'updatePart')
}

// Bulk update a single field on many parts at once
export async function bulkUpdateParts(ids, fields) {
  if (!ids.length) return
  const batchSize = 200
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize)
    const { error } = await supabase
      .from('parts')
      .update(fields)
      .in('id', batch)
    check(error, 'bulkUpdateParts')
  }
}

// Delete a single part by id
export async function deletePart(id) {
  const { error } = await supabase
    .from('parts')
    .delete()
    .eq('id', id)
  check(error, 'deletePart')
}

// Delete multiple parts by id array — used for bulk select delete
// Batches in groups of 100 to avoid query size limits
export async function deletePartsMany(ids) {
  if (!ids.length) return
  const batchSize = 100
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize)
    const { error } = await supabase
      .from('parts')
      .delete()
      .in('id', batch)
    check(error, 'deletePartsMany')
  }
}

// Upsert a batch of parts (used during BOM CSV import)
// Each part object must include all non-null fields.
export async function upsertParts(partsArray, userId) {
  if (!partsArray.length) return []
  const rows = partsArray.map(p => ({ ...p, created_by: userId, updated_by: userId }))
  const { data, error } = await supabase
    .from('parts')
    .insert(rows)
    .select()
  check(error, 'upsertParts')
  return data
}

// ─────────────────────────────────────────────
// API KEYS (team-shared)
// ─────────────────────────────────────────────

// Fetch all api_key rows as a plain key→value object
export async function fetchApiKeys() {
  const { data, error } = await supabase
    .from('api_keys')
    .select('key_name, key_value')
  check(error, 'fetchApiKeys')
  // Convert row array → { nexar_client_id: '...', mouser_api_key: '...', ... }
  return Object.fromEntries(data.map(r => [r.key_name, r.key_value]))
}

// Save a single api key value
export async function saveApiKey(keyName, keyValue, userId) {
  const { error } = await supabase
    .from('api_keys')
    .update({ key_value: keyValue, updated_by: userId })
    .eq('key_name', keyName)
  check(error, 'saveApiKey')
}

// Save all api keys at once (used by settings save button)
// Only updates rows that already exist in the table (RLS blocks inserts)
export async function saveAllApiKeys(keysObj, userId) {
  const { data: existing } = await supabase
    .from('api_keys')
    .select('key_name')
  const existingNames = new Set((existing || []).map(r => r.key_name))

  const updates = Object.entries(keysObj)
    .filter(([key_name]) => existingNames.has(key_name))
    .map(([key_name, key_value]) =>
      supabase.from('api_keys')
        .update({ key_value: key_value ?? "", updated_by: userId })
        .eq('key_name', key_name)
    )

  if (updates.length) {
    const results = await Promise.all(updates)
    for (const { error } of results) check(error, 'saveAllApiKeys')
  }
}

// ─────────────────────────────────────────────
// REALTIME SUBSCRIPTIONS
// ─────────────────────────────────────────────

// Subscribe to live changes on the products table.
// callback(eventType, newRow, oldRow) is called on every INSERT/UPDATE/DELETE.
// Returns the channel — call channel.unsubscribe() on component unmount.
export function subscribeToProducts(callback) {
  return supabase
    .channel('products-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'products' },
      (payload) => callback(payload.eventType, payload.new, payload.old)
    )
    .subscribe()
}

// Subscribe to live changes on the parts table.
export function subscribeToParts(callback) {
  return supabase
    .channel('parts-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'parts' },
      (payload) => callback(payload.eventType, payload.new, payload.old)
    )
    .subscribe()
}

// ─────────────────────────────────────────────
// TEAM MEMBERS
// ─────────────────────────────────────────────

export async function fetchTeamMembers() {
  const { data, error } = await supabase
    .from('team_members')
    .select('*')
    .order('name', { ascending: true })
  check(error, 'fetchTeamMembers')
  return data
}

export async function createTeamMember(fields) {
  const { data, error } = await supabase
    .from('team_members')
    .insert(fields)
    .select()
    .single()
  check(error, 'createTeamMember')
  return data
}

export async function updateTeamMember(id, fields) {
  const { error } = await supabase
    .from('team_members')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
  check(error, 'updateTeamMember')
}

export async function deleteTeamMember(id) {
  const { error } = await supabase
    .from('team_members')
    .delete()
    .eq('id', id)
  check(error, 'deleteTeamMember')
}

// ─────────────────────────────────────────────
// BUILD ORDERS
// ─────────────────────────────────────────────

export async function fetchBuildOrders() {
  const { data, error } = await supabase
    .from('build_orders')
    .select('*')
    .order('created_at', { ascending: false })
  check(error, 'fetchBuildOrders')
  return data
}

export async function createBuildOrder(fields, userId) {
  const { data, error } = await supabase
    .from('build_orders')
    .insert({ ...fields, created_by: userId })
    .select()
    .single()
  check(error, 'createBuildOrder')
  return data
}

export async function updateBuildOrder(id, fields) {
  const { error } = await supabase
    .from('build_orders')
    .update(fields)
    .eq('id', id)
  check(error, 'updateBuildOrder')
}

export async function deleteBuildOrder(id) {
  const { error } = await supabase
    .from('build_orders')
    .delete()
    .eq('id', id)
  check(error, 'deleteBuildOrder')
}

// ─────────────────────────────────────────────
// BUILD ASSIGNMENTS
// ─────────────────────────────────────────────

export async function fetchBuildAssignments() {
  const { data, error } = await supabase
    .from('build_assignments')
    .select('*')
    .order('created_at', { ascending: false })
  check(error, 'fetchBuildAssignments')
  return data
}

export async function createBuildAssignment(fields) {
  const { data, error } = await supabase
    .from('build_assignments')
    .insert(fields)
    .select()
    .single()
  check(error, 'createBuildAssignment')
  return data
}

export async function updateBuildAssignment(id, fields) {
  const { error } = await supabase
    .from('build_assignments')
    .update(fields)
    .eq('id', id)
  check(error, 'updateBuildAssignment')
}

// ─────────────────────────────────────────────
// REALTIME — Production tables
// ─────────────────────────────────────────────

export function subscribeToTeamMembers(callback) {
  return supabase
    .channel('team-members-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members' },
      (payload) => callback(payload.eventType, payload.new, payload.old)
    )
    .subscribe()
}

export function subscribeToBuildOrders(callback) {
  return supabase
    .channel('build-orders-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'build_orders' },
      (payload) => callback(payload.eventType, payload.new, payload.old)
    )
    .subscribe()
}

export function subscribeToBuildAssignments(callback) {
  return supabase
    .channel('build-assignments-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'build_assignments' },
      (payload) => callback(payload.eventType, payload.new, payload.old)
    )
    .subscribe()
}

// ─────────────────────────────────────────────
// PRICE HISTORY
// ─────────────────────────────────────────────

// Record a price point — skips if the latest price for this part+supplier is the same
export async function recordPrice(partId, unitPrice, supplier, source) {
  if (!partId || unitPrice == null || unitPrice <= 0) return
  const price = parseFloat(unitPrice)
  if (isNaN(price) || price <= 0) return

  // Check last recorded price for this part+supplier to avoid duplicates
  const { data: latest } = await supabase
    .from('price_history')
    .select('unit_price')
    .eq('part_id', partId)
    .eq('supplier', supplier || '')
    .order('recorded_at', { ascending: false })
    .limit(1)
  if (latest && latest.length > 0 && parseFloat(latest[0].unit_price) === price) return

  const { error } = await supabase
    .from('price_history')
    .insert({ part_id: partId, unit_price: price, supplier: supplier || '', source: source || 'manual' })
  if (error) console.error('[db:recordPrice]', error.message)
}

// Fetch all price history for a single part, newest first
export async function fetchPriceHistory(partId) {
  const { data, error } = await supabase
    .from('price_history')
    .select('*')
    .eq('part_id', partId)
    .order('recorded_at', { ascending: false })
  check(error, 'fetchPriceHistory')
  return data
}

// ─────────────────────────────────────────────
// BOM SNAPSHOTS
// ─────────────────────────────────────────────

// Save a BOM snapshot to the database
export async function saveBomSnapshot(label, snapshot, userId) {
  const { data, error } = await supabase
    .from('bom_snapshots')
    .insert({ label, snapshot, created_by: userId })
    .select()
    .single()
  check(error, 'saveBomSnapshot')
  return data
}

// Fetch all BOM snapshots, newest first, limit 50
export async function fetchBomSnapshots() {
  const { data, error } = await supabase
    .from('bom_snapshots')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)
  check(error, 'fetchBomSnapshots')
  return data
}

// ─────────────────────────────────────────────
// PO HISTORY
// ─────────────────────────────────────────────

// Fetch all PO history records, newest first
export async function fetchPOHistory() {
  const { data, error } = await supabase
    .from('po_history')
    .select('*')
    .order('created_at', { ascending: false })
  check(error, 'fetchPOHistory')
  return data
}

// Create a new PO history record
export async function createPORecord(fields, userId) {
  const { data, error } = await supabase
    .from('po_history')
    .insert({ ...fields, created_by: userId })
    .select()
    .single()
  check(error, 'createPORecord')
  return data
}

// Update a PO history record
export async function updatePORecord(id, fields) {
  const { error } = await supabase
    .from('po_history')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
  check(error, 'updatePORecord')
}

// ─────────────────────────────────────────────
// TEAM MEMBER PIN LOOKUP
// ─────────────────────────────────────────────

// Look up a team member by their PIN code
export async function findTeamMemberByPin(pinCode) {
  const { data, error } = await supabase
    .from('team_members')
    .select('*')
    .eq('pin_code', pinCode)
    .eq('active', true)
    .single()
  if (error && error.code === 'PGRST116') return null // no match
  check(error, 'findTeamMemberByPin')
  return data
}

// ─────────────────────────────────────────────
// SCRAP LOG
// ─────────────────────────────────────────────

// Fetch all scrap log entries, newest first
export async function fetchScrapLog() {
  const { data, error } = await supabase
    .from('scrap_log')
    .select('*')
    .order('created_at', { ascending: false })
  check(error, 'fetchScrapLog')
  return data
}

// Insert a new scrap log entry
export async function createScrapEntry(fields) {
  const { data, error } = await supabase
    .from('scrap_log')
    .insert(fields)
    .select()
    .single()
  check(error, 'createScrapEntry')
  return data
}

// Subscribe to live changes on the scrap_log table
export function subscribeToScrapLog(callback) {
  return supabase
    .channel('scrap-log-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'scrap_log' },
      (payload) => callback(payload.eventType, payload.new, payload.old)
    )
    .subscribe()
}

// Fetch all price history (for product-level rollups)
export async function fetchAllPriceHistory() {
  const { data, error } = await supabase
    .from('price_history')
    .select('*')
    .order('recorded_at', { ascending: false })
  check(error, 'fetchAllPriceHistory')
  return data
}
