import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        const {
            symbol,
            contractType,
            amount,
            duration,
            durationUnit,
            barrier,
        } = body;

        if (!symbol || !contractType || !amount || !duration) {
            return NextResponse.json(
                { error: 'Missing trade information' },
                { status: 400 }
            );
        }

        // We will connect the follower's Deriv account here next.
        console.log('Copy trade received:', {
            symbol,
            contractType,
            amount,
            duration,
            durationUnit,
            barrier,
        });

        return NextResponse.json({
            success: true,
            message: 'Copy trade request received',
        });
    } catch (error) {
        console.error('Copy trade API error:', error);

        return NextResponse.json(
            { error: 'Copy trade failed' },
            { status: 500 }
        );
    }
}
