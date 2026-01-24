# Stayca Frontend Integration Guide

Complete guide for integrating the Stayca backend with your Expo + React Native app.

---

## Table of Contents

1. [Setup](#setup)
2. [Authentication](#authentication)
3. [API Integration](#api-integration)
4. [Example API Calls](#example-api-calls)
5. [React Hooks](#react-hooks)
6. [Error Handling](#error-handling)
7. [TypeScript Types](#typescript-types)

---

## Setup

### 1. Install Dependencies

```bash
cd your-expo-app
npm install @supabase/supabase-js
# or
yarn add @supabase/supabase-js
```

### 2. Environment Variables

Create `.env` in your Expo app root:

```bash
EXPO_PUBLIC_SUPABASE_URL=https://jtuxuahigeqnmjsomuld.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0dXh1YWhpZ2Vxbm1qc29tdWxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyMTM4NzAsImV4cCI6MjA4NDc4OTg3MH0.An-Y2KghyXfPsRIDFWc_cteMRONtBtAAtBAJ2ukqrho
```

**Important:** Never include `SUPABASE_SERVICE_ROLE_KEY` or `GOOGLE_PLACES_API_KEY` in frontend!

### 3. Create Supabase Client

**`lib/supabase.ts`:**
```typescript
import 'react-native-url-polyfill/auto'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})
```

---

## Authentication

### Sign Up

```typescript
import { supabase } from './lib/supabase'

const signUp = async (email: string, password: string, username: string) => {
  // 1. Create auth user
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
  })

  if (authError) throw authError

  // 2. Create profile
  if (authData.user) {
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: authData.user.id,
        username,
      })

    if (profileError) throw profileError
  }

  return authData
}
```

### Sign In

```typescript
const signIn = async (email: string, password: string) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) throw error
  return data
}
```

### Sign Out

```typescript
const signOut = async () => {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}
```

### Get Current User

```typescript
const getCurrentUser = async () => {
  const { data: { user } } = await supabase.auth.getUser()
  return user
}
```

### Auth State Listener

```typescript
import { useEffect, useState } from 'react'
import { Session } from '@supabase/supabase-js'

function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  return { session, loading, user: session?.user }
}
```

---

## API Integration

### Base API Client

**`lib/api.ts`:**
```typescript
import { supabase } from './supabase'

const API_BASE_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1`

class ApiClient {
  private async getAuthHeaders() {
    const { data: { session } } = await supabase.auth.getSession()
    
    if (!session) {
      throw new Error('Not authenticated')
    }

    return {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    }
  }

  async get<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const headers = await this.getAuthHeaders()
    const url = new URL(`${API_BASE_URL}${endpoint}`)
    
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, value)
      })
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers,
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Request failed')
    }

    return response.json()
  }

  async post<T>(endpoint: string, body?: any): Promise<T> {
    const headers = await this.getAuthHeaders()

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Request failed')
    }

    return response.json()
  }

  async put<T>(endpoint: string, body?: any): Promise<T> {
    const headers = await this.getAuthHeaders()

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'PUT',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Request failed')
    }

    return response.json()
  }

  async delete<T>(endpoint: string): Promise<T> {
    const headers = await this.getAuthHeaders()

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'DELETE',
      headers,
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Request failed')
    }

    return response.json()
  }
}

export const api = new ApiClient()
```

---

## Example API Calls

### 1. Search Hotels

```typescript
// lib/places.ts
import { api } from './api'

export interface PlaceSearchResult {
  place_id: string
  name: string
  address: string
  rating?: number
  user_ratings_total?: number
  photo_reference?: string
  lat?: number
  lng?: number
}

export const searchHotels = async (
  query: string,
  location?: { lat: number; lng: number },
  radius?: number
): Promise<PlaceSearchResult[]> => {
  const params: Record<string, string> = { query }
  
  if (location) {
    params.location = `${location.lat},${location.lng}`
  }
  if (radius) {
    params.radius = radius.toString()
  }

  const response = await api.get<{ results: PlaceSearchResult[] }>(
    '/places-search',
    params
  )
  
  return response.results
}

// Usage in component:
const SearchScreen = () => {
  const [results, setResults] = useState<PlaceSearchResult[]>([])
  const [loading, setLoading] = useState(false)

  const handleSearch = async (query: string) => {
    setLoading(true)
    try {
      const hotels = await searchHotels(query)
      setResults(hotels)
    } catch (error) {
      console.error('Search failed:', error)
      Alert.alert('Error', 'Failed to search hotels')
    } finally {
      setLoading(false)
    }
  }

  return (
    <View>
      <TextInput 
        placeholder="Search hotels..."
        onSubmitEditing={(e) => handleSearch(e.nativeEvent.text)}
      />
      {loading && <ActivityIndicator />}
      <FlatList
        data={results}
        renderItem={({ item }) => <HotelCard hotel={item} />}
      />
    </View>
  )
}
```

### 2. Get Hotel Details

```typescript
// lib/places.ts
export interface PlaceDetails {
  place_id: string
  name: string
  address: string
  phone?: string
  website?: string
  rating?: number
  price_level?: number
  photos?: string[]
  lat?: number
  lng?: number
  chain?: string
  city?: string
  country?: string
}

export const getHotelDetails = async (
  placeId: string
): Promise<PlaceDetails> => {
  return api.get<PlaceDetails>('/places-details', { place_id: placeId })
}

// Usage:
const HotelDetailScreen = ({ route }) => {
  const { placeId } = route.params
  const [hotel, setHotel] = useState<PlaceDetails | null>(null)

  useEffect(() => {
    getHotelDetails(placeId).then(setHotel)
  }, [placeId])

  if (!hotel) return <ActivityIndicator />

  return (
    <ScrollView>
      <Text style={styles.title}>{hotel.name}</Text>
      <Text>{hotel.address}</Text>
      <Text>Rating: {hotel.rating}/5</Text>
      {hotel.phone && <Text>Phone: {hotel.phone}</Text>}
    </ScrollView>
  )
}
```

### 3. Add Hotel to WANT List

```typescript
// lib/stays.ts
import { api } from './api'

export type StayStatus = 'WANT' | 'BEEN'
export type Sentiment = 'LIKED' | 'FINE' | 'DISLIKED'

export interface StayInput {
  status: StayStatus
  sentiment?: Sentiment | null
  stayed_at?: string | null
}

export const updateStay = async (
  placeId: string,
  data: StayInput
): Promise<void> => {
  await api.put(`/stays/${placeId}`, data)
}

// Usage:
const AddToWantButton = ({ placeId }: { placeId: string }) => {
  const [loading, setLoading] = useState(false)

  const handleAddToWant = async () => {
    setLoading(true)
    try {
      await updateStay(placeId, { status: 'WANT' })
      Alert.alert('Success', 'Added to your want list!')
    } catch (error) {
      Alert.alert('Error', 'Failed to add hotel')
    } finally {
      setLoading(false)
    }
  }

  return (
    <TouchableOpacity onPress={handleAddToWant} disabled={loading}>
      <Text>Add to Want List</Text>
    </TouchableOpacity>
  )
}
```

### 4. Mark Hotel as BEEN

```typescript
// Usage:
const MarkAsBeenModal = ({ placeId, onClose }: Props) => {
  const [sentiment, setSentiment] = useState<Sentiment>('LIKED')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    setLoading(true)
    try {
      await updateStay(placeId, {
        status: 'BEEN',
        sentiment,
        stayed_at: new Date().toISOString(),
      })
      Alert.alert('Success', 'Marked as been!')
      onClose()
    } catch (error) {
      Alert.alert('Error', 'Failed to update')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal visible>
      <Text>How did you like it?</Text>
      <Button title="😍 I liked it!" onPress={() => setSentiment('LIKED')} />
      <Button title="😐 It was fine" onPress={() => setSentiment('FINE')} />
      <Button title="😞 I didn't like it" onPress={() => setSentiment('DISLIKED')} />
      <Button title="Submit" onPress={handleSubmit} loading={loading} />
    </Modal>
  )
}
```

### 5. Get Rankings

```typescript
// lib/rankings.ts
import { api } from './api'

export interface RankedHotel {
  place_id: string
  name: string
  city?: string
  country?: string
  rating: number
  score10: number
  sentiment: Sentiment
  games_played: number
  photo?: string
}

export const getRankings = async (): Promise<RankedHotel[]> => {
  const response = await api.get<{ rankings: RankedHotel[] }>('/rankings-me')
  return response.rankings
}

// Usage:
const RankingsScreen = () => {
  const [rankings, setRankings] = useState<RankedHotel[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getRankings()
      .then(setRankings)
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <ActivityIndicator />

  return (
    <FlatList
      data={rankings}
      renderItem={({ item, index }) => (
        <View style={styles.rankCard}>
          <Text style={styles.rank}>#{index + 1}</Text>
          <Text style={styles.hotelName}>{item.name}</Text>
          <Text style={styles.score}>{item.score10.toFixed(1)}/10</Text>
          <Text style={styles.sentiment}>
            {item.sentiment === 'LIKED' ? '😍' : 
             item.sentiment === 'FINE' ? '😐' : '😞'}
          </Text>
          <Text style={styles.games}>
            {item.games_played} comparisons
          </Text>
        </View>
      )}
      keyExtractor={(item) => item.place_id}
    />
  )
}
```

### 6. Elo Battle Pair

```typescript
// lib/elo.ts
import { api } from './api'

export interface BattlePair {
  placeAId: string
  placeBId: string
  placeA?: {
    name: string
    city?: string
    photo?: string
  }
  placeB?: {
    name: string
    city?: string
    photo?: string
  }
}

export const getBattlePair = async (): Promise<BattlePair> => {
  return api.post<BattlePair>('/elo-battle-pair')
}

export const submitMatch = async (
  placeAId: string,
  placeBId: string,
  winnerPlaceId: string
): Promise<void> => {
  await api.post('/elo-submit-match', {
    placeAId,
    placeBId,
    winnerPlaceId,
  })
}

// Usage:
const BattleScreen = () => {
  const [pair, setPair] = useState<BattlePair | null>(null)
  const [loading, setLoading] = useState(false)

  const loadPair = async () => {
    setLoading(true)
    try {
      const newPair = await getBattlePair()
      setPair(newPair)
    } catch (error) {
      Alert.alert('Error', 'Need at least 2 hotels in BEEN list')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPair()
  }, [])

  const handleChoice = async (winnerId: string) => {
    if (!pair) return
    
    setLoading(true)
    try {
      await submitMatch(pair.placeAId, pair.placeBId, winnerId)
      Alert.alert('Success', 'Rankings updated!')
      loadPair() // Load next pair
    } catch (error) {
      Alert.alert('Error', 'Failed to submit')
    } finally {
      setLoading(false)
    }
  }

  if (!pair) return <ActivityIndicator />

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Which hotel do you prefer?</Text>
      
      <TouchableOpacity 
        style={styles.hotelCard}
        onPress={() => handleChoice(pair.placeAId)}
        disabled={loading}
      >
        <Text style={styles.hotelName}>{pair.placeA?.name}</Text>
        <Text>{pair.placeA?.city}</Text>
      </TouchableOpacity>

      <Text style={styles.vs}>VS</Text>

      <TouchableOpacity 
        style={styles.hotelCard}
        onPress={() => handleChoice(pair.placeBId)}
        disabled={loading}
      >
        <Text style={styles.hotelName}>{pair.placeB?.name}</Text>
        <Text>{pair.placeB?.city}</Text>
      </TouchableOpacity>
    </View>
  )
}
```

### 7. Get Feed

```typescript
// lib/feed.ts
import { api } from './api'

export interface FeedEvent {
  id: string
  actor_id: string
  event_type: 'FOLLOW' | 'POST' | 'ELO_MATCH' | 'MARK_BEEN' | 'WISHLIST'
  payload: any
  created_at: string
}

export const getFeed = async (
  limit = 20,
  cursor?: string
): Promise<{ events: FeedEvent[]; next_cursor: string | null }> => {
  const params: Record<string, string> = { limit: limit.toString() }
  if (cursor) params.cursor = cursor
  
  return api.get('/feed', params)
}

// Usage with infinite scroll:
const FeedScreen = () => {
  const [events, setEvents] = useState<FeedEvent[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const loadFeed = async (isRefresh = false) => {
    if (loading) return
    
    setLoading(true)
    try {
      const response = await getFeed(20, isRefresh ? undefined : cursor)
      setEvents(isRefresh ? response.events : [...events, ...response.events])
      setCursor(response.next_cursor)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadFeed(true)
  }, [])

  return (
    <FlatList
      data={events}
      renderItem={({ item }) => <FeedEventCard event={item} />}
      onEndReached={() => cursor && loadFeed()}
      onEndReachedThreshold={0.5}
      refreshing={loading}
      onRefresh={() => loadFeed(true)}
    />
  )
}
```

### 8. Follow/Unfollow User

```typescript
// lib/social.ts
import { api } from './api'

export const followUser = async (userId: string): Promise<void> => {
  await api.post(`/follow/${userId}`)
}

export const unfollowUser = async (userId: string): Promise<void> => {
  await api.delete(`/follow/${userId}`)
}

// Usage:
const FollowButton = ({ userId, isFollowing: initialState }: Props) => {
  const [isFollowing, setIsFollowing] = useState(initialState)
  const [loading, setLoading] = useState(false)

  const handleToggle = async () => {
    setLoading(true)
    try {
      if (isFollowing) {
        await unfollowUser(userId)
        setIsFollowing(false)
      } else {
        await followUser(userId)
        setIsFollowing(true)
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to update follow status')
    } finally {
      setLoading(false)
    }
  }

  return (
    <TouchableOpacity onPress={handleToggle} disabled={loading}>
      <Text>{isFollowing ? 'Following' : 'Follow'}</Text>
    </TouchableOpacity>
  )
}
```

### 9. Create Post

```typescript
// lib/posts.ts
import { api } from './api'

export const createPost = async (
  placeId: string,
  text: string,
  tags?: string[]
): Promise<void> => {
  await api.post('/posts', { place_id: placeId, text, tags })
}

// Usage:
const CreatePostScreen = ({ route }) => {
  const { placeId } = route.params
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    if (!text.trim()) return
    
    setLoading(true)
    try {
      await createPost(placeId, text)
      Alert.alert('Success', 'Post created!')
      navigation.goBack()
    } catch (error) {
      Alert.alert('Error', 'Failed to create post')
    } finally {
      setLoading(false)
    }
  }

  return (
    <View>
      <TextInput
        multiline
        placeholder="Share your experience..."
        value={text}
        onChangeText={setText}
        maxLength={2000}
      />
      <Text>{text.length}/2000</Text>
      <Button title="Post" onPress={handleSubmit} loading={loading} />
    </View>
  )
}
```

### 10. Get User Profile

```typescript
// lib/profile.ts
import { api } from './api'

export interface UserProfile {
  id: string
  username: string
  avatar_url?: string
  created_at: string
  stats: {
    been_count: number
    want_count: number
    followers_count: number
    following_count: number
  }
  is_following: boolean
  is_own_profile: boolean
}

export const getUserProfile = async (userId: string): Promise<UserProfile> => {
  return api.get<{ profile: UserProfile }>(`/profile/${userId}`)
    .then(res => res.profile)
}

export const updateProfile = async (data: {
  username?: string
  avatar_url?: string | null
}): Promise<UserProfile> => {
  return api.patch<{ profile: UserProfile }>('/profile', data)
    .then(res => res.profile)
}

// Usage:
const ProfileScreen = ({ route }) => {
  const { userId } = route.params
  const [profile, setProfile] = useState<UserProfile | null>(null)

  useEffect(() => {
    getUserProfile(userId).then(setProfile)
  }, [userId])

  if (!profile) return <ActivityIndicator />

  return (
    <ScrollView>
      <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
      <Text style={styles.username}>@{profile.username}</Text>
      
      <View style={styles.stats}>
        <StatItem label="Been" value={profile.stats.been_count} />
        <StatItem label="Want" value={profile.stats.want_count} />
        <StatItem label="Followers" value={profile.stats.followers_count} />
        <StatItem label="Following" value={profile.stats.following_count} />
      </View>

      {!profile.is_own_profile && (
        <FollowButton 
          userId={userId} 
          isFollowing={profile.is_following} 
        />
      )}
    </ScrollView>
  )
}
```

---

## React Hooks

### useRankings Hook

```typescript
import { useState, useEffect } from 'react'
import { getRankings, RankedHotel } from '../lib/rankings'

export const useRankings = () => {
  const [rankings, setRankings] = useState<RankedHotel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getRankings()
      setRankings(data)
    } catch (e) {
      setError(e as Error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  return { rankings, loading, error, refresh }
}

// Usage:
const MyRankingsScreen = () => {
  const { rankings, loading, error, refresh } = useRankings()

  if (loading) return <ActivityIndicator />
  if (error) return <Text>Error: {error.message}</Text>

  return (
    <FlatList
      data={rankings}
      renderItem={({ item, index }) => (
        <RankingCard hotel={item} rank={index + 1} />
      )}
      refreshing={loading}
      onRefresh={refresh}
    />
  )
}
```

### useHotelSearch Hook

```typescript
import { useState } from 'react'
import { searchHotels, PlaceSearchResult } from '../lib/places'

export const useHotelSearch = () => {
  const [results, setResults] = useState<PlaceSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const search = async (query: string) => {
    if (!query.trim()) return

    setLoading(true)
    setError(null)
    try {
      const data = await searchHotels(query)
      setResults(data)
    } catch (e) {
      setError(e as Error)
    } finally {
      setLoading(false)
    }
  }

  const clear = () => {
    setResults([])
    setError(null)
  }

  return { results, loading, error, search, clear }
}
```

---

## Error Handling

### Global Error Handler

```typescript
// lib/errorHandler.ts
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public originalError?: any
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const handleApiError = (error: any): string => {
  if (error instanceof ApiError) {
    switch (error.statusCode) {
      case 401:
        return 'Please sign in to continue'
      case 403:
        return 'You don\'t have permission to do that'
      case 404:
        return 'Item not found'
      case 429:
        return 'Too many requests. Please try again later'
      default:
        return error.message
    }
  }

  if (error.message?.includes('network')) {
    return 'Network error. Please check your connection'
  }

  return 'Something went wrong. Please try again'
}

// Usage:
try {
  await updateStay(placeId, data)
} catch (error) {
  const message = handleApiError(error)
  Alert.alert('Error', message)
}
```

---

## TypeScript Types

**`types/api.ts`:**
```typescript
export type StayStatus = 'WANT' | 'BEEN'
export type Sentiment = 'LIKED' | 'FINE' | 'DISLIKED'
export type EventType = 'FOLLOW' | 'POST' | 'ELO_MATCH' | 'MARK_BEEN' | 'WISHLIST'

export interface Stay {
  id: string
  user_id: string
  place_id: string
  status: StayStatus
  sentiment: Sentiment | null
  stayed_at: string | null
  created_at: string
  updated_at: string
}

export interface EloRating {
  user_id: string
  place_id: string
  rating: number
  games_played: number
  updated_at: string
}

export interface RankedHotel {
  place_id: string
  name: string
  rating: number
  score10: number
  sentiment: Sentiment
  games_played: number
  city?: string
  country?: string
  chain?: string
  photo?: string
}

export interface BattlePair {
  placeAId: string
  placeBId: string
  placeA?: PlacePreview
  placeB?: PlacePreview
}

export interface PlacePreview {
  name: string
  city?: string
  country?: string
  photo?: string
}
```

---

## Complete Example: Hotel Detail Screen

```typescript
import React, { useEffect, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native'
import { getHotelDetails, PlaceDetails } from '../lib/places'
import { updateStay, StayStatus, Sentiment } from '../lib/stays'

const HotelDetailScreen = ({ route, navigation }) => {
  const { placeId } = route.params
  const [hotel, setHotel] = useState<PlaceDetails | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadHotel()
  }, [placeId])

  const loadHotel = async () => {
    try {
      const data = await getHotelDetails(placeId)
      setHotel(data)
    } catch (error) {
      Alert.alert('Error', 'Failed to load hotel details')
    } finally {
      setLoading(false)
    }
  }

  const handleAddToWant = async () => {
    try {
      await updateStay(placeId, { status: 'WANT' })
      Alert.alert('Success', 'Added to your want list!')
    } catch (error) {
      Alert.alert('Error', 'Failed to add hotel')
    }
  }

  const handleMarkAsBeen = async (sentiment: Sentiment) => {
    try {
      await updateStay(placeId, {
        status: 'BEEN',
        sentiment,
        stayed_at: new Date().toISOString(),
      })
      Alert.alert('Success', 'Marked as been!')
      navigation.navigate('Rankings') // Go to rankings
    } catch (error) {
      Alert.alert('Error', 'Failed to update')
    }
  }

  if (loading) return <ActivityIndicator />
  if (!hotel) return <Text>Hotel not found</Text>

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>{hotel.name}</Text>
      <Text style={styles.address}>{hotel.address}</Text>
      {hotel.rating && (
        <Text style={styles.rating}>⭐ {hotel.rating}/5</Text>
      )}
      
      <View style={styles.actions}>
        <TouchableOpacity 
          style={styles.button}
          onPress={handleAddToWant}
        >
          <Text>Add to Want List</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.button}
          onPress={() => handleMarkAsBeen('LIKED')}
        >
          <Text>😍 I've been & liked it</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  )
}

export default HotelDetailScreen
```

---

## Testing Tips

1. **Use React Native Debugger** for network inspection
2. **Test auth flows thoroughly** (sign in, sign out, token refresh)
3. **Handle offline scenarios** gracefully
4. **Mock API calls** in tests
5. **Test with real data** from your Supabase project

---

## Troubleshooting

### "Not authenticated" error
- Check if user is signed in
- Verify session is valid
- Token may have expired (should auto-refresh)

### "Network request failed"
- Check EXPO_PUBLIC_SUPABASE_URL is correct
- Verify edge functions are deployed
- Check device has internet connection

### "Invalid JWT"
- Token format may be wrong
- Check Authorization header is set correctly
- Ensure using `session.access_token`, not `session.user.id`

---

## Resources

- [Supabase JS Client Docs](https://supabase.com/docs/reference/javascript/introduction)
- [Expo Environment Variables](https://docs.expo.dev/guides/environment-variables/)
- [React Native Async Storage](https://react-native-async-storage.github.io/async-storage/)

---

**You're ready to integrate! 🚀**

All your backend endpoints are now accessible from your Expo app with type-safe API calls and proper authentication.
