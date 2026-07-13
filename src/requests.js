/**
 * ============================================
 * requests.js
 * Handles all network requests to the database/API.
 * ============================================
 */

const API_BASE_URL = 'https://decidio-api-production.up.railway.app/api';

// Helper function for handling responses
async function handleResponse(response) {
    if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }
    return await response.json();
}

// Add to new
async function createList(name, description = "") {
    try {
        const { jwtToken } = await chrome.storage.local.get("jwtToken");

        const response = await fetch(`${API_BASE_URL}/lists`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json',
                'Authorization': `Bearer ${jwtToken}`
             },
            body: JSON.stringify({ name, description })
        });
        
        return await handleResponse(response); // List id is just id
    
    } catch (error) {
        console.error("Failed to create list:", error);
        throw error;
    }
}

// Adding an item in general
async function addItemToList(listId, productId) {
    try {
        const { jwtToken } = await chrome.storage.local.get("jwtToken");

        const response = await fetch(`${API_BASE_URL}/lists/${listId}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json',
                'Authorization': `Bearer ${jwtToken}`
             },
            body: JSON.stringify({ product_id: productId })
        });
        return await handleResponse(response);
    } catch (error) {
        console.error(`Failed to add item ${productId} to list ${listId}:`, error);
        throw error;
    }
}

// Add to existing
async function getAllLists() {
    try {
        const { jwtToken } = await chrome.storage.local.get("jwtToken");

        const response = await fetch(`${API_BASE_URL}/lists`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json',
                'Authorization': `Bearer ${jwtToken}`
             }
        });
        return await handleResponse(response);
    } catch (error) {
        console.error("Failed to fetch lists:", error);
        throw error;
    }
}