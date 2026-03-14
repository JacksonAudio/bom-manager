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
export async function createProduct({ name, color, userId, shopify_product_id }) {
  const row = { name, color, created_by: userId };
  if (shopify_product_id) row.shopify_product_id = shopify_product_id;
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

// Delete a single part by id
export async function deletePart(id) {
  const { error } = await supabase
    .from('parts')
    .delete()
    .eq('id', id)
  check(error, 'deletePart')
}

// Delete multiple parts by id array — used for bulk select delete
export async function deletePartsMany(ids) {
  if (!ids.length) return
  const { error } = await supabase
    .from('parts')
    .delete()
    .in('id', ids)
  check(error, 'deletePartsMany')
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
