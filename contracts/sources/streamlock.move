/// StreamLock Protocol - Trustless Pay-Per-Second Video Streaming
///
/// This module implements the core protocol for pay-per-second video streaming
/// with cryptographic commitments for trustless key verification.
///
/// Payment Token: USDC (Fungible Asset standard)
module streamlock::protocol {
    use std::string::String;
    use std::signer;
    use aptos_framework::fungible_asset::Metadata;
    use aptos_framework::primary_fungible_store;
    use aptos_framework::object::{Self, Object};
    use aptos_framework::timestamp;
    use aptos_framework::event;
    use aptos_framework::account::{Self, SignerCapability};
    use aptos_std::table::{Self, Table};
    use aptos_std::simple_map::{Self, SimpleMap};

    use streamlock::errors;

    // ============ Events ============

    #[event]
    /// Emitted when a creator registers
    struct CreatorRegisteredEvent has drop, store {
        creator: address,
        timestamp: u64,
    }

    #[event]
    /// Emitted when a video is registered
    struct VideoRegisteredEvent has drop, store {
        video_id: u128,
        creator: address,
        total_segments: u64,
        price_per_segment: u64,
        commitment_root: vector<u8>,
        timestamp: u64,
    }

    #[event]
    /// Emitted when video price is updated
    struct VideoPriceUpdatedEvent has drop, store {
        video_id: u128,
        old_price: u64,
        new_price: u64,
        timestamp: u64,
    }

    #[event]
    /// Emitted when video is deactivated
    struct VideoDeactivatedEvent has drop, store {
        video_id: u128,
        timestamp: u64,
    }

    #[event]
    /// Emitted when a viewing session starts
    struct SessionStartedEvent has drop, store {
        session_id: u128,
        video_id: u128,
        viewer: address,
        prepaid_amount: u64,
        timestamp: u64,
    }

    #[event]
    /// Emitted when a segment is paid for
    struct SegmentPaidEvent has drop, store {
        session_id: u128,
        video_id: u128,
        segment_index: u64,
        amount: u64,
        timestamp: u64,
    }

    #[event]
    /// Emitted when a session is topped up
    struct SessionToppedUpEvent has drop, store {
        session_id: u128,
        additional_amount: u64,
        new_balance: u64,
        timestamp: u64,
    }

    #[event]
    /// Emitted when a session ends
    struct SessionEndedEvent has drop, store {
        session_id: u128,
        segments_watched: u64,
        total_paid: u64,
        refunded: u64,
        timestamp: u64,
    }

    #[event]
    /// Emitted when creator withdraws earnings
    struct EarningsWithdrawnEvent has drop, store {
        creator: address,
        amount: u64,
        timestamp: u64,
    }

    // ============ Constants ============

    /// USDC Fungible Asset metadata address (Aptos Testnet)
    /// Get testnet USDC from: https://faucet.circle.com/
    const USDC_METADATA_ADDRESS: address = @0x69091fbab5f7d635ee7ac5098cf0c1efbe31d68fec0f2cd565e8d168daf52832;

    /// Minimum segment price in USDC micro-units (0.0001 USDC = 100 units, since USDC has 6 decimals)
    const MIN_SEGMENT_PRICE: u64 = 100;

    /// Default session duration (2 hours)
    const DEFAULT_SESSION_DURATION: u64 = 7200;

    /// Protocol fee in basis points (1% = 100)
    const DEFAULT_PROTOCOL_FEE_BPS: u64 = 100;

    /// Basis points denominator
    const BPS_DENOMINATOR: u64 = 10000;

    // ============ Structs ============

    /// Global protocol configuration
    struct GlobalConfig has key {
        admin: address,
        protocol_fee_bps: u64,
        treasury: address,
        min_segment_price: u64,
        paused: bool,
        next_video_id: u128,
        next_session_id: u128,
        total_protocol_fees: u64,
    }

    /// Escrow capability for fund management
    struct EscrowCapability has key {
        signer_cap: SignerCapability,
        escrow_address: address,
    }

    /// Creator profile
    struct Creator has key, store {
        total_earnings: u64,
        pending_withdrawal: u64,
        total_videos: u64,
        registered_at: u64,
        metadata_uri: String,
    }

    /// Video registration
    struct Video has store, drop {
        video_id: u128,
        creator: address,
        content_uri: String,
        thumbnail_uri: String,
        duration_seconds: u64,
        total_segments: u64,
        key_commitment_root: vector<u8>,
        price_per_segment: u64,
        total_views: u64,
        total_earnings: u64,
        is_active: bool,
        created_at: u64,
    }

    /// Viewing session with escrow
    struct ViewingSession has store, drop {
        session_id: u128,
        video_id: u128,
        viewer: address,
        creator: address,
        segments_paid: u64,
        prepaid_balance: u64,
        total_paid: u64,
        started_at: u64,
        expires_at: u64,
        is_active: bool,
        paid_segments: SimpleMap<u64, bool>,
    }

    /// Video registry
    struct VideoRegistry has key {
        videos: Table<u128, Video>,
    }

    /// Session registry
    struct SessionRegistry has key {
        sessions: Table<u128, ViewingSession>,
    }

    // ============ Helper Functions ============

    /// Get the USDC metadata object
    inline fun usdc_metadata(): Object<Metadata> {
        object::address_to_object<Metadata>(USDC_METADATA_ADDRESS)
    }

    // ============ Initialization ============

    /// Initialize the protocol (called once by deployer)
    public entry fun initialize(
        admin: &signer,
        treasury: address,
        protocol_fee_bps: u64
    ) {
        let admin_addr = signer::address_of(admin);

        // Create resource account for escrow
        let seed = b"streamlock_escrow_v2_usdc";
        let (escrow_signer, signer_cap) = account::create_resource_account(admin, seed);
        let escrow_addr = signer::address_of(&escrow_signer);

        // Ensure the escrow account can receive USDC (FA standard)
        // Primary fungible stores are automatically created on first deposit,
        // but we explicitly ensure the escrow account exists
        let _ = &escrow_signer;

        // Store escrow capability
        move_to(admin, EscrowCapability {
            signer_cap,
            escrow_address: escrow_addr,
        });

        // Create global config
        move_to(admin, GlobalConfig {
            admin: admin_addr,
            protocol_fee_bps,
            treasury,
            min_segment_price: MIN_SEGMENT_PRICE,
            paused: false,
            next_video_id: 1,
            next_session_id: 1,
            total_protocol_fees: 0,
        });

        // Create registries
        move_to(admin, VideoRegistry {
            videos: table::new(),
        });

        move_to(admin, SessionRegistry {
            sessions: table::new(),
        });
    }

    // ============ Creator Functions ============

    /// Register as a creator
    public entry fun register_creator(
        creator: &signer,
        metadata_uri: String
    ) acquires GlobalConfig {
        let creator_addr = signer::address_of(creator);
        let config = borrow_global<GlobalConfig>(@streamlock);

        // Check not already registered
        assert!(!exists<Creator>(creator_addr), errors::already_registered());

        // Check protocol not paused
        assert!(!config.paused, errors::protocol_paused());

        let now = timestamp::now_seconds();

        // Create creator profile
        move_to(creator, Creator {
            total_earnings: 0,
            pending_withdrawal: 0,
            total_videos: 0,
            registered_at: now,
            metadata_uri,
        });

        // Emit event
        event::emit(CreatorRegisteredEvent { creator: creator_addr, timestamp: now });
    }

    /// Register a new video
    public entry fun register_video(
        creator: &signer,
        content_uri: String,
        thumbnail_uri: String,
        duration_seconds: u64,
        total_segments: u64,
        key_commitment_root: vector<u8>,
        price_per_segment: u64
    ) acquires GlobalConfig, Creator, VideoRegistry {
        let creator_addr = signer::address_of(creator);
        let config = borrow_global_mut<GlobalConfig>(@streamlock);

        // Check creator is registered
        assert!(exists<Creator>(creator_addr), errors::not_registered());

        // Check protocol not paused
        assert!(!config.paused, errors::protocol_paused());

        // Check price meets minimum
        assert!(price_per_segment >= config.min_segment_price, errors::price_too_low());

        // Check commitment root is valid (32 bytes for SHA256)
        assert!(std::vector::length(&key_commitment_root) == 32, errors::invalid_commitment());

        let now = timestamp::now_seconds();
        let video_id = config.next_video_id;
        config.next_video_id = video_id + 1;

        // Create video
        let video = Video {
            video_id,
            creator: creator_addr,
            content_uri,
            thumbnail_uri,
            duration_seconds,
            total_segments,
            key_commitment_root,
            price_per_segment,
            total_views: 0,
            total_earnings: 0,
            is_active: true,
            created_at: now,
        };

        // Add to registry
        let registry = borrow_global_mut<VideoRegistry>(@streamlock);
        table::add(&mut registry.videos, video_id, video);

        // Update creator stats
        let creator_profile = borrow_global_mut<Creator>(creator_addr);
        creator_profile.total_videos = creator_profile.total_videos + 1;

        // Emit event
        event::emit(VideoRegisteredEvent {
            video_id,
            creator: creator_addr,
            total_segments,
            price_per_segment,
            commitment_root: key_commitment_root,
            timestamp: now,
        });
    }

    /// Update video price (only affects new sessions)
    public entry fun update_video_price(
        creator: &signer,
        video_id: u128,
        new_price_per_segment: u64
    ) acquires GlobalConfig, VideoRegistry {
        let creator_addr = signer::address_of(creator);
        let config = borrow_global<GlobalConfig>(@streamlock);

        assert!(new_price_per_segment >= config.min_segment_price, errors::price_too_low());

        let registry = borrow_global_mut<VideoRegistry>(@streamlock);
        assert!(table::contains(&registry.videos, video_id), errors::video_not_found());

        let video = table::borrow_mut(&mut registry.videos, video_id);
        assert!(video.creator == creator_addr, errors::unauthorized());

        let old_price = video.price_per_segment;
        video.price_per_segment = new_price_per_segment;

        // Emit event
        let now = timestamp::now_seconds();
        event::emit(VideoPriceUpdatedEvent {
            video_id,
            old_price,
            new_price: new_price_per_segment,
            timestamp: now,
        });
    }

    /// Deactivate a video
    public entry fun deactivate_video(
        creator: &signer,
        video_id: u128
    ) acquires VideoRegistry {
        let creator_addr = signer::address_of(creator);

        let registry = borrow_global_mut<VideoRegistry>(@streamlock);
        assert!(table::contains(&registry.videos, video_id), errors::video_not_found());

        let video = table::borrow_mut(&mut registry.videos, video_id);
        assert!(video.creator == creator_addr, errors::unauthorized());

        video.is_active = false;

        // Emit event
        let now = timestamp::now_seconds();
        event::emit(VideoDeactivatedEvent { video_id, timestamp: now });
    }

    // ============ Viewer Functions ============

    /// Start a viewing session with prepayment (USDC)
    public entry fun start_session(
        viewer: &signer,
        video_id: u128,
        prepaid_segments: u64,
        max_duration_seconds: u64
    ) acquires GlobalConfig, EscrowCapability, VideoRegistry, SessionRegistry {
        let viewer_addr = signer::address_of(viewer);
        let config = borrow_global_mut<GlobalConfig>(@streamlock);

        assert!(!config.paused, errors::protocol_paused());

        // Get video
        let registry = borrow_global<VideoRegistry>(@streamlock);
        assert!(table::contains(&registry.videos, video_id), errors::video_not_found());
        let video = table::borrow(&registry.videos, video_id);
        assert!(video.is_active, errors::video_not_active());

        // Calculate prepayment
        let prepaid_amount = prepaid_segments * video.price_per_segment;

        // Get escrow address and transfer USDC funds
        let escrow_cap = borrow_global<EscrowCapability>(@streamlock);
        primary_fungible_store::transfer(viewer, usdc_metadata(), escrow_cap.escrow_address, prepaid_amount);

        let now = timestamp::now_seconds();
        let session_id = config.next_session_id;
        config.next_session_id = session_id + 1;

        let duration = if (max_duration_seconds > 0 && max_duration_seconds < DEFAULT_SESSION_DURATION) {
            max_duration_seconds
        } else {
            DEFAULT_SESSION_DURATION
        };

        // Create session with SimpleMap for O(1) lookups
        let session = ViewingSession {
            session_id,
            video_id,
            viewer: viewer_addr,
            creator: video.creator,
            segments_paid: 0,
            prepaid_balance: prepaid_amount,
            total_paid: 0,
            started_at: now,
            expires_at: now + duration,
            is_active: true,
            paid_segments: simple_map::new(),
        };

        // Add to registry
        let session_registry = borrow_global_mut<SessionRegistry>(@streamlock);
        table::add(&mut session_registry.sessions, session_id, session);

        // Emit event
        event::emit(SessionStartedEvent {
            session_id,
            video_id,
            viewer: viewer_addr,
            prepaid_amount,
            timestamp: now,
        });
    }

    /// Pay for a segment
    public entry fun pay_for_segment(
        viewer: &signer,
        session_id: u128,
        segment_index: u64
    ) acquires GlobalConfig, VideoRegistry, SessionRegistry, Creator {
        let viewer_addr = signer::address_of(viewer);

        let session_registry = borrow_global_mut<SessionRegistry>(@streamlock);
        assert!(table::contains(&session_registry.sessions, session_id), errors::session_not_found());

        let session = table::borrow_mut(&mut session_registry.sessions, session_id);
        assert!(session.viewer == viewer_addr, errors::unauthorized());
        assert!(session.is_active, errors::session_not_found());

        let now = timestamp::now_seconds();
        assert!(now <= session.expires_at, errors::session_expired());

        // Get video for price and validation
        let video_registry = borrow_global_mut<VideoRegistry>(@streamlock);
        let video = table::borrow_mut(&mut video_registry.videos, session.video_id);

        // Check bounds first (more specific error)
        assert!(segment_index < video.total_segments, errors::invalid_segment_index());

        // Check not already paid - O(1) lookup with SimpleMap
        assert!(!simple_map::contains_key(&session.paid_segments, &segment_index), errors::segment_already_paid());

        // Check sufficient balance
        let price = video.price_per_segment;
        assert!(session.prepaid_balance >= price, errors::insufficient_balance());

        // Calculate protocol fee
        let config = borrow_global_mut<GlobalConfig>(@streamlock);
        let fee = (price * config.protocol_fee_bps) / BPS_DENOMINATOR;
        let creator_amount = price - fee;

        // Track protocol fees
        config.total_protocol_fees = config.total_protocol_fees + fee;

        // Update session
        session.prepaid_balance = session.prepaid_balance - price;
        session.total_paid = session.total_paid + price;
        session.segments_paid = session.segments_paid + 1;
        simple_map::add(&mut session.paid_segments, segment_index, true);

        // Update video stats (full price for accounting)
        video.total_earnings = video.total_earnings + price;

        // Update creator earnings (minus fee)
        let creator = borrow_global_mut<Creator>(session.creator);
        creator.total_earnings = creator.total_earnings + creator_amount;
        creator.pending_withdrawal = creator.pending_withdrawal + creator_amount;

        // Emit event
        event::emit(SegmentPaidEvent {
            session_id,
            video_id: session.video_id,
            segment_index,
            amount: price,
            timestamp: now,
        });
    }

    /// Top up session with more USDC funds
    public entry fun top_up_session(
        viewer: &signer,
        session_id: u128,
        additional_segments: u64
    ) acquires EscrowCapability, VideoRegistry, SessionRegistry {
        let viewer_addr = signer::address_of(viewer);

        let session_registry = borrow_global_mut<SessionRegistry>(@streamlock);
        assert!(table::contains(&session_registry.sessions, session_id), errors::session_not_found());

        let session = table::borrow_mut(&mut session_registry.sessions, session_id);
        assert!(session.viewer == viewer_addr, errors::unauthorized());
        assert!(session.is_active, errors::session_not_found());

        // Get video for price
        let video_registry = borrow_global<VideoRegistry>(@streamlock);
        let video = table::borrow(&video_registry.videos, session.video_id);

        let additional_amount = additional_segments * video.price_per_segment;

        // Get escrow address and transfer USDC funds
        let escrow_cap = borrow_global<EscrowCapability>(@streamlock);
        primary_fungible_store::transfer(viewer, usdc_metadata(), escrow_cap.escrow_address, additional_amount);

        session.prepaid_balance = session.prepaid_balance + additional_amount;

        // Extend session expiry if running low
        let now = timestamp::now_seconds();
        if (session.expires_at < now + DEFAULT_SESSION_DURATION) {
            session.expires_at = now + DEFAULT_SESSION_DURATION;
        };

        // Emit event
        event::emit(SessionToppedUpEvent {
            session_id,
            additional_amount,
            new_balance: session.prepaid_balance,
            timestamp: now,
        });
    }

    /// End session and refund unused USDC balance
    public entry fun end_session(
        viewer: &signer,
        session_id: u128
    ) acquires EscrowCapability, SessionRegistry, VideoRegistry {
        let viewer_addr = signer::address_of(viewer);

        let session_registry = borrow_global_mut<SessionRegistry>(@streamlock);
        assert!(table::contains(&session_registry.sessions, session_id), errors::session_not_found());

        let session = table::borrow_mut(&mut session_registry.sessions, session_id);
        assert!(session.viewer == viewer_addr, errors::unauthorized());
        assert!(session.is_active, errors::session_not_found());

        let now = timestamp::now_seconds();
        let refund_amount = session.prepaid_balance;
        let segments_paid = session.segments_paid;
        let total_paid = session.total_paid;
        let video_id = session.video_id;

        // Mark session as ended
        session.is_active = false;
        session.prepaid_balance = 0;

        // Refund unused USDC balance from escrow
        if (refund_amount > 0) {
            let escrow_cap = borrow_global<EscrowCapability>(@streamlock);
            let escrow_signer = account::create_signer_with_capability(&escrow_cap.signer_cap);
            primary_fungible_store::transfer(&escrow_signer, usdc_metadata(), viewer_addr, refund_amount);
        };

        // Update video views
        let video_registry = borrow_global_mut<VideoRegistry>(@streamlock);
        let video = table::borrow_mut(&mut video_registry.videos, video_id);
        video.total_views = video.total_views + 1;

        // Emit event
        event::emit(SessionEndedEvent {
            session_id,
            segments_watched: segments_paid,
            total_paid,
            refunded: refund_amount,
            timestamp: now,
        });
    }

    /// Withdraw creator USDC earnings
    public entry fun withdraw_earnings(
        creator: &signer
    ) acquires EscrowCapability, Creator {
        let creator_addr = signer::address_of(creator);
        assert!(exists<Creator>(creator_addr), errors::not_registered());

        let creator_profile = borrow_global_mut<Creator>(creator_addr);
        let amount = creator_profile.pending_withdrawal;

        assert!(amount > 0, errors::insufficient_balance());

        creator_profile.pending_withdrawal = 0;

        // Transfer USDC from escrow to creator
        let escrow_cap = borrow_global<EscrowCapability>(@streamlock);
        let escrow_signer = account::create_signer_with_capability(&escrow_cap.signer_cap);
        primary_fungible_store::transfer(&escrow_signer, usdc_metadata(), creator_addr, amount);

        let now = timestamp::now_seconds();
        event::emit(EarningsWithdrawnEvent {
            creator: creator_addr,
            amount,
            timestamp: now,
        });
    }

    /// Withdraw protocol fees in USDC (admin only)
    public entry fun withdraw_protocol_fees(
        admin: &signer
    ) acquires GlobalConfig, EscrowCapability {
        let admin_addr = signer::address_of(admin);
        let config = borrow_global_mut<GlobalConfig>(@streamlock);

        // Only admin can withdraw fees
        assert!(admin_addr == config.admin, errors::unauthorized());

        let amount = config.total_protocol_fees;
        assert!(amount > 0, errors::insufficient_balance());

        config.total_protocol_fees = 0;

        // Transfer USDC from escrow to treasury
        let escrow_cap = borrow_global<EscrowCapability>(@streamlock);
        let escrow_signer = account::create_signer_with_capability(&escrow_cap.signer_cap);
        primary_fungible_store::transfer(&escrow_signer, usdc_metadata(), config.treasury, amount);
    }

    // ============ View Functions ============

    #[view]
    /// Get video details
    public fun get_video(video_id: u128): (
        address,
        String,
        String,
        u64,
        u64,
        vector<u8>,
        u64,
        bool
    ) acquires VideoRegistry {
        let registry = borrow_global<VideoRegistry>(@streamlock);
        assert!(table::contains(&registry.videos, video_id), errors::video_not_found());

        let video = table::borrow(&registry.videos, video_id);
        (
            video.creator,
            video.content_uri,
            video.thumbnail_uri,
            video.duration_seconds,
            video.total_segments,
            video.key_commitment_root,
            video.price_per_segment,
            video.is_active
        )
    }

    #[view]
    /// Get session details
    public fun get_session(session_id: u128): (
        u128,
        address,
        address,
        u64,
        u64,
        u64,
        bool
    ) acquires SessionRegistry {
        let registry = borrow_global<SessionRegistry>(@streamlock);
        assert!(table::contains(&registry.sessions, session_id), errors::session_not_found());

        let session = table::borrow(&registry.sessions, session_id);
        (
            session.video_id,
            session.viewer,
            session.creator,
            session.segments_paid,
            session.prepaid_balance,
            session.total_paid,
            session.is_active
        )
    }

    #[view]
    /// Get creator details
    public fun get_creator(creator_addr: address): (u64, u64, u64) acquires Creator {
        assert!(exists<Creator>(creator_addr), errors::not_registered());
        let creator = borrow_global<Creator>(creator_addr);
        (
            creator.total_earnings,
            creator.pending_withdrawal,
            creator.total_videos
        )
    }

    #[view]
    /// Get segment price for a video
    public fun get_segment_price(video_id: u128): u64 acquires VideoRegistry {
        let registry = borrow_global<VideoRegistry>(@streamlock);
        assert!(table::contains(&registry.videos, video_id), errors::video_not_found());

        let video = table::borrow(&registry.videos, video_id);
        video.price_per_segment
    }

    #[view]
    /// Check if segment is paid in a session
    public fun is_segment_paid(session_id: u128, segment_index: u64): bool acquires SessionRegistry {
        let registry = borrow_global<SessionRegistry>(@streamlock);
        assert!(table::contains(&registry.sessions, session_id), errors::session_not_found());

        let session = table::borrow(&registry.sessions, session_id);
        simple_map::contains_key(&session.paid_segments, &segment_index)
    }

    #[view]
    /// Get escrow address
    public fun get_escrow_address(): address acquires EscrowCapability {
        let escrow_cap = borrow_global<EscrowCapability>(@streamlock);
        escrow_cap.escrow_address
    }

    #[view]
    /// Get total protocol fees collected
    public fun get_protocol_fees(): u64 acquires GlobalConfig {
        let config = borrow_global<GlobalConfig>(@streamlock);
        config.total_protocol_fees
    }

    #[view]
    /// Get USDC metadata address (for client-side reference)
    public fun get_usdc_metadata_address(): address {
        USDC_METADATA_ADDRESS
    }
}
