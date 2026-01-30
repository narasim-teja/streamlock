/// StreamLock event definitions
module streamlock::events {
    use std::string::String;

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

    // Event constructors
    public fun new_creator_registered(creator: address, timestamp: u64): CreatorRegisteredEvent {
        CreatorRegisteredEvent { creator, timestamp }
    }

    public fun new_video_registered(
        video_id: u128,
        creator: address,
        total_segments: u64,
        price_per_segment: u64,
        commitment_root: vector<u8>,
        timestamp: u64
    ): VideoRegisteredEvent {
        VideoRegisteredEvent {
            video_id,
            creator,
            total_segments,
            price_per_segment,
            commitment_root,
            timestamp,
        }
    }

    public fun new_session_started(
        session_id: u128,
        video_id: u128,
        viewer: address,
        prepaid_amount: u64,
        timestamp: u64
    ): SessionStartedEvent {
        SessionStartedEvent {
            session_id,
            video_id,
            viewer,
            prepaid_amount,
            timestamp,
        }
    }

    public fun new_segment_paid(
        session_id: u128,
        video_id: u128,
        segment_index: u64,
        amount: u64,
        timestamp: u64
    ): SegmentPaidEvent {
        SegmentPaidEvent {
            session_id,
            video_id,
            segment_index,
            amount,
            timestamp,
        }
    }

    public fun new_session_ended(
        session_id: u128,
        segments_watched: u64,
        total_paid: u64,
        refunded: u64,
        timestamp: u64
    ): SessionEndedEvent {
        SessionEndedEvent {
            session_id,
            segments_watched,
            total_paid,
            refunded,
            timestamp,
        }
    }

    public fun new_earnings_withdrawn(
        creator: address,
        amount: u64,
        timestamp: u64
    ): EarningsWithdrawnEvent {
        EarningsWithdrawnEvent { creator, amount, timestamp }
    }

    public fun new_price_updated(
        video_id: u128,
        old_price: u64,
        new_price: u64,
        timestamp: u64
    ): VideoPriceUpdatedEvent {
        VideoPriceUpdatedEvent {
            video_id,
            old_price,
            new_price,
            timestamp,
        }
    }

    public fun new_video_deactivated(
        video_id: u128,
        timestamp: u64
    ): VideoDeactivatedEvent {
        VideoDeactivatedEvent { video_id, timestamp }
    }

    public fun new_session_topped_up(
        session_id: u128,
        additional_amount: u64,
        new_balance: u64,
        timestamp: u64
    ): SessionToppedUpEvent {
        SessionToppedUpEvent {
            session_id,
            additional_amount,
            new_balance,
            timestamp,
        }
    }
}
