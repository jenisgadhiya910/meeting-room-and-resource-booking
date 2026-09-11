# POC: Meeting Room and Resource Booking

**Track:** Scheduling · **Status:** Required · **Path:** React to Full Stack — 101 (2-week solo POC)
**Stack:** Express or Next.js (engineer's choice) · PostgreSQL · Prisma

## 1. Background

Rooms get double-booked, recurring bookings block rooms nobody actually uses, and there's no
way to find a free room at short notice without walking the floor.

You're building the booking system that fixes this: users search for a room by what they
actually need (time, capacity, equipment), book it, and the system guarantees that a room
booked by one person can't simultaneously be booked by another — even when two requests land
at the exact same moment.

This POC's centre of gravity is **correctness under concurrency**. The feature list is
simple to demo happy-path; it's only interesting once you try to break it.

## 2. Actors

| Role                            | Can do                                                             |
| ------------------------------- | ------------------------------------------------------------------ |
| **User**                        | Search rooms, book, view own bookings, cancel/shorten own bookings |
| **Admin** _(optional, stretch)_ | Manage the room list and equipment attributes, view utilisation    |

## 3. Functional requirements

### 3.1 Room catalogue

- Rooms have a name/location, capacity, and a set of equipment attributes (e.g. projector,
  video conferencing, whiteboard).
- Users can filter search results by any combination of these attributes.

### 3.2 Availability search

- Given a date, time range and minimum capacity, return rooms that are actually free for that
  entire window — not rooms that merely have _some_ free time that day.
- This is a real query against booking data, not a client-side filter over "all rooms."

### 3.3 Booking

- A user selects an available room and slot and books it; they receive confirmation.
- **Two people booking the same room for an overlapping time must not both succeed.** This is
  the core hard case of this POC. It has to hold up under two requests arriving at the same
  instant, not just one after the other — how you guarantee that is entirely your design
  decision, and you should be ready to explain why you didn't pick one of the other reasonable
  approaches.

### 3.4 Cancelling and shortening

- A booking can be cancelled or shortened (end time moved earlier) by the person who made it.
- The freed time must become immediately bookable by someone else — no stale "still booked"
  window.
- Decide what happens if someone tries to shorten a booking that has already started, and
  document the rule.

### 3.5 Recurring bookings

- A user can book a room for a weekly recurring series (e.g. "every Tuesday 10–11am for 8
  weeks").
- A single occurrence within a series can be cancelled without affecting the rest of the
  series. Think through how you represent that in the schema — a design that treats the whole
  series as one row tends to break the moment someone cancels a single occurrence.

### 3.6 Utilisation view

- An admin-facing view showing room utilisation by room and by week (e.g. hours booked vs.
  hours available).
- Should be a real aggregate query, ready to explain its cost.

## 4. Data to think through

You choose the exact schema. At minimum, your model needs to represent: rooms and their
attributes (a room can have several, an attribute can apply to many rooms), bookings tied to a
room and a user with a start and end time, and a way to represent a recurring series such that
one occurrence can be cancelled independently of the rest.

The question worth sitting with before you write any code: how do you guarantee, at the point
two overlapping booking requests both arrive, that only one of them can win? There's more than
one legitimate way to do this — pick one, and be ready to explain what would go wrong with the
approaches you didn't pick.

## 5. How it's exposed

Design the API surface — routes, methods, request/response shapes — however fits the workflow
above. There's no prescribed structure here; the requirements in §3 are the spec, not a
particular set of endpoints.

## 6. Things this POC will specifically be checked for

- Bad input — a booking with the end time before the start, a reference to a room that doesn't
  exist — should be rejected before it reaches your business logic.
- A double-booking attempt should come back as a clear, specific failure your frontend can act
  on, not a generic error and not a silent success.
- Booking and cancelling require a real, authenticated user; there's no anonymous path.
- A user can cancel or shorten only their own bookings — including if they try to reach
  someone else's booking directly by its ID. Prove this with a test, not a UI check.
- The double-booking guarantee (§3.3) is the whole point of this POC. Have a test that fires
  two overlapping requests concurrently and asserts exactly one succeeds — not two sequential
  requests that happen to look fine.
- Room search needs to support filtering by capacity and attributes; the utilisation view
  needs to support filtering by date range — neither should mean loading every row and
  filtering in code.
- Booking creation, cancellation, and any rejected double-booking attempt should leave a
  structured trace — useful evidence when a user disputes "the system let someone steal my
  room."
- The whole thing should come up with `docker compose up` and no manual setup beyond a
  documented `.env`.
